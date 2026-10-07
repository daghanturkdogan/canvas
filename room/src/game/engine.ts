import {
  CANVAS_H, CANVAS_W, GRID_H, GRID_W, HISTORY_LIMIT, MAX_FILL_SHARE, MAX_OPS_POINTS,
  MAX_PTS_PER_MSG, MIN_FILL_CELLS, NAME_MAX, OP_CHUNK, PALETTE, phaseAt, scheduledMode,
  type ModeId, type ModeState, type Op, type PlayerInfo, type RoundInfo, type RoundSummary, type ServerMsg,
} from '@gallery/shared';
import { decimate, type Pt } from './geometry';
import { LoopTrail } from './loops';
import { REGISTRY, type ModeApi, type ModeEntry, type RoundRef } from './modes';
import { OwnershipGrid } from './ownership';
import type { EngineConfig, Outbound, PlayerState } from './types';
import type { PersistedPlayer, Store } from '../store/store';

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const BUCKET_CAP = 40;
const BUCKET_REFILL_PER_MS = 40 / 1000;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Anonymous';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return cleaned || 'Anonymous';
}

export class GameEngine {
  readonly grid = new OwnershipGrid();
  ops: Op[] = [];
  players = new Map<string, PlayerState>();
  history: RoundSummary[] = [];
  roundIdx = -1;
  finalized = false;
  winnerPid: number | null = null;
  modeState: ModeState | null = null;

  private opPoints = 0;
  private strokeIdx = new Map<string, number>();
  private dirtyFrom = Infinity;
  private metaDirty = false;
  private scoresDirty = true;
  private modeStateDirty = false;
  private idCounter = 0;
  private clockNow = 0;
  readonly modeApi: ModeApi;

  constructor(readonly cfg: EngineConfig, private store: Store, now: number) {
    const self = this;
    this.modeApi = { get state() { return self.modeState; }, setState: (n) => self.setModeState(n) };
    this.clockNow = now;
    this.restore();
    this.advance(now);
  }

  // ---- connection lifecycle ------------------------------------------------

  join(clientId: string, rawName: unknown, password: unknown, now: number): Outbound[] {
    const only = { only: typeof clientId === 'string' ? clientId : '' };
    if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
      return [{ to: only, msg: { t: 'error', reason: 'bad-join' } }];
    }
    if (this.cfg.password && password !== this.cfg.password) {
      return [{ to: only, msg: { t: 'error', reason: 'bad-password' } }];
    }
    this.clockNow = now;
    const out = this.advance(now);
    const name = sanitizeName(rawName);
    let p = this.players.get(clientId);
    if (p) {
      p.name = name;
    } else {
      const slot = this.allocSlot();
      if (slot === null) return [{ to: only, msg: { t: 'error', reason: 'room-full' } }];
      p = this.newPlayer(clientId, slot, name, now);
      this.players.set(clientId, p);
    }
    p.online = true;
    p.lastSeen = now;
    this.metaDirty = true;
    this.entry(this.roundIdx).rules.onJoin?.({
      player: p, players: [...this.players.values()], now, round: this.roundRef(), api: this.modeApi,
    });
    out.push({ to: only, msg: this.welcome(p, now) });
    out.push({ to: 'all', msg: { t: 'players', players: this.playerInfos() } });
    return out;
  }

  disconnect(clientId: string, now: number): Outbound[] {
    const p = this.players.get(clientId);
    if (!p) return [];
    p.online = false;
    p.lastSeen = now;
    p.curStroke = null;
    p.curOpId = null;
    this.metaDirty = true;
    return [{ to: 'all', msg: { t: 'players', players: this.playerInfos() } }];
  }

  // ---- drawing ---------------------------------------------------------------

  onStroke(clientId: string, raw: unknown, now: number): Outbound[] {
    const p = this.players.get(clientId);
    if (!p || !p.online) return [];
    if (!this.take(p, now)) return [];
    this.clockNow = now;
    const out = this.advance(now);
    if (phaseAt(now, this.cfg.roundMs, this.cfg.overMs).phase !== 'playing') return out;

    const m = raw as { id?: unknown; pts?: unknown; end?: unknown; erase?: unknown } | null;
    if (!m || typeof m !== 'object') return out;
    if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 40) return out;
    if (!Array.isArray(m.pts) || m.pts.length < 2 || m.pts.length % 2 !== 0 || m.pts.length > MAX_PTS_PER_MSG * 2) return out;
    if (this.opPoints >= MAX_OPS_POINTS) return out;

    const pts: Pt[] = [];
    for (let i = 0; i < m.pts.length; i += 2) {
      const x = m.pts[i], y = m.pts[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return out;
      pts.push({ x: clamp(Math.round(x), 0, CANVAS_W), y: clamp(Math.round(y), 0, CANVAS_H) });
    }

    if (p.lastMsgAt && now - p.lastMsgAt < 500 && p.curStroke === m.id) p.stats.drawMs += now - p.lastMsgAt;
    p.lastMsgAt = now;

    const entry = this.entry(this.roundIdx);
    const runs = entry.rules.filterPoints
      ? entry.rules.filterPoints({
          player: p, pts, now, roundIdx: this.roundIdx, round: this.roundRef(), api: this.modeApi,
        }).filter((r) => r.length > 0)
      : [pts];
    if (runs.length === 0) {
      p.curStroke = null;
      p.curOpId = null;
      return out;
    }

    const wantsErase = m.erase === true && entry.rules.allowsErase === true;
    let continuing = p.curStroke === m.id && p.curOpId != null && this.strokeIdx.has(`${p.slot}:${p.curOpId}`);
    let opId = continuing ? p.curOpId! : m.id;
    for (const run of runs) {
      if (!continuing) opId = this.freshId(p.slot, m.id);
      this.applyRun(p, opId, run, !continuing, wantsErase, entry, out, clientId);
      continuing = false; // any later run in this batch comes after a gap
    }

    const lastRun = runs[runs.length - 1]!;
    const tailKept = lastRun[lastRun.length - 1] === pts[pts.length - 1];
    if (m.end === true || !tailKept) {
      p.curStroke = null;
      p.curOpId = null;
    } else {
      p.curStroke = m.id;
      p.curOpId = opId;
    }
    return out;
  }

  private applyRun(
    p: PlayerState, opId: string, pts: Pt[], newStroke: boolean, wantsErase: boolean, entry: ModeEntry,
    out: Outbound[], clientId: string,
  ): void {
    const key = `${p.slot}:${opId}`;
    const existingOp = newStroke ? null : (this.ops[this.strokeIdx.get(key)!] as Extract<Op, { k: 's' }>);
    const owner = existingOp ? existingOp.pid : (entry.rules.erases || wantsErase ? 0 : p.slot);
    const brush = owner === 0 ? (entry.def.eraseBrush ?? entry.def.brush) : entry.def.brush;
    let opIndex: number;
    let prev: Pt | null = null;
    if (newStroke) {
      opIndex = this.pushOp({ k: 's', id: opId, pid: owner, pts: [] });
      this.strokeIdx.set(key, opIndex);
    } else {
      opIndex = this.strokeIdx.get(key)!;
      const existing = this.ops[opIndex] as Extract<Op, { k: 's' }>;
      const n = existing.pts.length;
      prev = { x: existing.pts[n - 2]!, y: existing.pts[n - 1]! };
      this.dirtyFrom = Math.min(this.dirtyFrom, opIndex);
    }
    const op = this.ops[opIndex] as Extract<Op, { k: 's' }>;
    const flat = pts.flatMap((q) => [q.x, q.y]);
    op.pts.push(...flat);
    this.opPoints += pts.length;

    const path = prev ? [prev, ...pts] : pts;
    for (let i = 1; i < path.length; i++) p.stats.ink += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    p.stats.overdraw += this.grid.stampPath(owner, path, brush);
    this.scoresDirty = true;
    this.metaDirty = true;

    out.push({ to: { except: clientId }, msg: { t: 'stroke', id: opId, pid: owner, pts: flat } });

    const polys = entry.rules.onPoints({
      player: p, pts, newStroke, now: this.clockNow, round: this.roundRef(), api: this.modeApi,
    });
    for (const poly of polys) this.applyFill(p, poly, out);
  }

  private applyFill(p: PlayerState, poly: Pt[], out: Outbound[]): void {
    if (this.entry(this.roundIdx).rules.erases) return;
    const rounded = decimate(poly, 200).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
    const cells = this.grid.polygonCells(rounded);
    if (cells.length < MIN_FILL_CELLS || cells.length > MAX_FILL_SHARE * GRID_W * GRID_H) return;
    p.stats.overdraw += this.grid.setCells(p.slot, cells);
    const flat = rounded.flatMap((q) => [q.x, q.y]);
    this.pushOp({ k: 'f', pid: p.slot, poly: flat });
    out.push({ to: 'all', msg: { t: 'fill', pid: p.slot, poly: flat } });
    this.entry(this.roundIdx).rules.onFill?.({
      player: p, poly: rounded, now: this.clockNow, round: this.roundRef(), api: this.modeApi,
    });
  }

  // ---- mode state ---------------------------------------------------------------

  setModeState(next: ModeState | null): void {
    this.modeState = next;
    this.modeStateDirty = true;
    this.metaDirty = true;
  }

  // ---- clock -------------------------------------------------------------------

  tick(now: number): Outbound[] {
    this.clockNow = now;
    const out = this.advance(now);
    if (this.scoresDirty) {
      this.scoresDirty = false;
      out.push({ to: 'all', msg: { t: 'scores', shares: this.scores() } });
    }
    if (this.modeStateDirty) {
      this.modeStateDirty = false;
      out.push({ to: 'all', msg: { t: 'mode-state', idx: this.roundIdx, state: this.modeState } });
      if (this.entry(this.roundIdx).rules.playerInfo) {
        out.push({ to: 'all', msg: { t: 'players', players: this.playerInfos() } });
      }
    }
    return out;
  }

  nextEventAt(now: number): number {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    return w.phase === 'playing' ? w.overAt : w.endsAt;
  }

  roundOps(idx: number): Op[] {
    if (!Number.isInteger(idx)) return [];
    if (idx === this.roundIdx) return this.ops;
    if (!this.history.some((h) => h.idx === idx)) return [];
    return this.store.loadOpChunks(idx);
  }

  flush(): void {
    if (this.dirtyFrom < this.ops.length) {
      for (let c = Math.floor(this.dirtyFrom / OP_CHUNK); c * OP_CHUNK < this.ops.length; c++) {
        this.store.saveOpChunk(this.roundIdx, c, this.ops.slice(c * OP_CHUNK, (c + 1) * OP_CHUNK));
      }
      this.dirtyFrom = Infinity;
      this.metaDirty = true;
    }
    if (this.metaDirty) {
      this.store.saveMeta({
        roundIdx: this.roundIdx,
        finalized: this.finalized,
        players: [...this.players.values()].map(persist),
        modeState: this.modeState,
      });
      this.metaDirty = false;
    }
  }

  // ---- internals -----------------------------------------------------------------

  private modeIdAt(idx: number): ModeId {
    return this.cfg.order ? this.cfg.order[idx % this.cfg.order.length]! : scheduledMode(idx);
  }

  private entry(idx: number): ModeEntry {
    const reg = this.cfg.registry ?? REGISTRY;
    return reg[this.modeIdAt(idx)]!;
  }

  private roundRef(): RoundRef {
    const w = phaseAt(this.clockNow, this.cfg.roundMs, this.cfg.overMs);
    return { idx: this.roundIdx, startsAt: w.startsAt, overAt: w.overAt };
  }

  private scores(): Record<number, number> {
    const { rules } = this.entry(this.roundIdx);
    return rules.score
      ? rules.score({ grid: this.grid, players: [...this.players.values()], state: this.modeState, roundIdx: this.roundIdx })
      : this.grid.shares();
  }

  private freshId(slot: number, id: string): string {
    if (!this.strokeIdx.has(`${slot}:${id}`)) return id;
    let candidate: string;
    do { candidate = `${id}~${++this.idCounter}`; } while (this.strokeIdx.has(`${slot}:${candidate}`));
    return candidate;
  }

  private advance(now: number): Outbound[] {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    const out: Outbound[] = [];
    if (w.idx !== this.roundIdx) {
      if (this.roundIdx >= 0 && !this.finalized) this.finalize();
      this.startRound(w.idx);
      out.push({
        to: 'all',
        msg: { t: 'round', round: this.roundInfo(now), winnerPid: null, wipe: true, history: this.history },
      });
    }
    if (w.phase === 'over' && !this.finalized) {
      this.finalize();
      out.push({
        to: 'all',
        msg: { t: 'round', round: this.roundInfo(now), winnerPid: this.winnerPid, wipe: false, history: this.history },
      });
      out.push({ to: 'all', msg: { t: 'players', players: this.playerInfos() } });
    }
    return out;
  }

  private startRound(idx: number): void {
    this.roundIdx = idx;
    this.ops = [];
    this.opPoints = 0;
    this.grid.clear();
    this.strokeIdx.clear();
    this.dirtyFrom = Infinity;
    this.finalized = false;
    this.winnerPid = null;
    this.scoresDirty = true;
    const init = this.entry(idx).rules.init;
    const online = [...this.players.values()].filter((pl) => pl.online);
    this.modeState = init ? init({ roundIdx: idx, players: online }) : null;
    this.modeStateDirty = this.modeState !== null;
    for (const p of this.players.values()) {
      p.trail.reset();
      p.curStroke = null;
      p.curOpId = null;
    }
    this.store.pruneBefore(idx - HISTORY_LIMIT);
    this.metaDirty = true;
    this.flush();
  }

  private finalize(): void {
    this.finalized = true;
    this.flush();
    const shares = this.scores();
    let winner: number | null = null;
    let best = 0;
    for (const [slot, share] of Object.entries(shares)) {
      if (share > best) { best = share; winner = Number(slot); }
    }
    this.winnerPid = winner;
    if (this.ops.length === 0) { this.metaDirty = true; this.flush(); return; }
    const winnerPlayer = [...this.players.values()].find((p) => p.slot === winner);
    if (winnerPlayer) winnerPlayer.wins++;
    const players: RoundSummary['players'] = {};
    for (const info of this.playerInfos()) if (shares[info.pid] !== undefined) players[info.pid] = { name: info.name, color: info.color };
    const summary: RoundSummary = {
      idx: this.roundIdx,
      mode: this.modeIdAt(this.roundIdx),
      endedAt: (this.roundIdx + 1) * this.cfg.roundMs,
      winnerPid: winner,
      shares,
      players,
    };
    this.history = [...this.history, summary].slice(-HISTORY_LIMIT);
    this.store.saveSummary(summary);
    this.metaDirty = true;
    this.flush();
  }

  private pushOp(op: Op): number {
    this.ops.push(op);
    const i = this.ops.length - 1;
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    if (op.k === 'f') this.opPoints += op.poly.length / 2;
    return i;
  }

  private restore(): void {
    const meta = this.store.loadMeta();
    this.history = this.store.loadHistory(HISTORY_LIMIT);
    if (!meta) return;
    for (const pp of meta.players) {
      this.players.set(pp.clientId, { ...pp, online: false, trail: new LoopTrail(), curStroke: null, curOpId: null, lastMsgAt: 0, tokens: BUCKET_CAP, tokensAt: 0 });
    }
    this.roundIdx = meta.roundIdx;
    this.finalized = meta.finalized;
    const entry = this.entry(meta.roundIdx);
    this.modeState = meta.modeState !== undefined
      ? meta.modeState
      : (entry.rules.init?.({ roundIdx: meta.roundIdx, players: [] }) ?? null);
    this.ops = this.store.loadOpChunks(meta.roundIdx);
    for (const op of this.ops) {
      if (op.k === 's') {
        const pts: Pt[] = [];
        for (let i = 0; i < op.pts.length; i += 2) pts.push({ x: op.pts[i]!, y: op.pts[i + 1]! });
        this.grid.stampPath(op.pid, pts, op.pid === 0 ? (entry.def.eraseBrush ?? entry.def.brush) : entry.def.brush);
        this.opPoints += pts.length;
      } else {
        const poly: Pt[] = [];
        for (let i = 0; i < op.poly.length; i += 2) poly.push({ x: op.poly[i]!, y: op.poly[i + 1]! });
        this.grid.setCells(op.pid, this.grid.polygonCells(poly));
        this.opPoints += poly.length;
      }
    }
    if (this.finalized) {
      const shares = this.scores();
      let best = 0;
      for (const [slot, share] of Object.entries(shares)) if (share > best) { best = share; this.winnerPid = Number(slot); }
    }
  }

  private allocSlot(): number | null {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let s = 1; s <= PALETTE.length; s++) if (!used.has(s)) return s;
    let oldest: PlayerState | null = null;
    for (const p of this.players.values()) if (!p.online && (!oldest || p.lastSeen < oldest.lastSeen)) oldest = p;
    if (!oldest) return null;
    this.players.delete(oldest.clientId);
    return oldest.slot;
  }

  private newPlayer(clientId: string, slot: number, name: string, now: number): PlayerState {
    return {
      clientId, slot, name, color: PALETTE[slot - 1]!, online: true, lastSeen: now, wins: 0,
      stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null, curOpId: null,
      lastMsgAt: 0, tokens: BUCKET_CAP, tokensAt: now,
    };
  }

  private take(p: PlayerState, now: number): boolean {
    p.tokens = Math.min(BUCKET_CAP, p.tokens + Math.max(0, now - p.tokensAt) * BUCKET_REFILL_PER_MS);
    p.tokensAt = now;
    if (p.tokens < 1) return false;
    p.tokens -= 1;
    return true;
  }

  private roundInfo(now: number): RoundInfo {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    const e = this.entry(w.idx);
    const nx = this.entry(w.idx + 1).def;
    return {
      idx: w.idx, mode: e.def.id, modeName: e.def.name, rules: e.def.rules, howTo: e.def.howTo, brush: e.def.brush,
      phase: w.phase, startsAt: w.startsAt, overAt: w.overAt, endsAt: w.endsAt,
      next: { mode: nx.id, name: nx.name, rules: nx.rules, howTo: nx.howTo, brush: nx.brush },
    };
  }

  private playerInfos(): PlayerInfo[] {
    const players = [...this.players.values()].sort((a, b) => a.slot - b.slot);
    const view = this.entry(this.roundIdx).rules.playerInfo;
    return players.map((p) => {
      const info: PlayerInfo = { pid: p.slot, name: p.name, color: p.color, online: p.online, wins: p.wins };
      return view ? view(info, { state: this.modeState, players, roundIdx: this.roundIdx }) : info;
    });
  }

  private welcome(p: PlayerState, now: number): ServerMsg {
    return {
      t: 'welcome',
      serverNow: now,
      you: p.slot,
      players: this.playerInfos(),
      round: this.roundInfo(now),
      winnerPid: this.winnerPid,
      ops: this.ops,
      shares: this.scores(),
      history: this.history,
      modeState: this.modeState,
    };
  }
}

function persist(p: PlayerState): PersistedPlayer {
  return { clientId: p.clientId, slot: p.slot, name: p.name, color: p.color, wins: p.wins, lastSeen: p.lastSeen, stats: p.stats };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
