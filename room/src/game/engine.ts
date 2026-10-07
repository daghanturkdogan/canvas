import {
  BRUSH_RADIUS, CANVAS_H, CANVAS_W, GRID_H, GRID_W, HISTORY_LIMIT, MAX_FILL_SHARE, MAX_OPS_POINTS,
  MAX_PTS_PER_MSG, MIN_FILL_CELLS, NAME_MAX, OP_CHUNK, PALETTE, modeForRound, phaseAt,
  type Op, type PlayerInfo, type RoundInfo, type RoundSummary, type ServerMsg,
} from '@gallery/shared';
import { decimate, type Pt } from './geometry';
import { LoopTrail } from './loops';
import { MODES } from './modes';
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

  private opPoints = 0;
  private strokeIdx = new Map<string, number>();
  private dirtyFrom = Infinity;
  private metaDirty = false;
  private scoresDirty = true;

  constructor(readonly cfg: EngineConfig, private store: Store, now: number) {
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
    this.metaDirty = true;
    return [{ to: 'all', msg: { t: 'players', players: this.playerInfos() } }];
  }

  // ---- drawing ---------------------------------------------------------------

  onStroke(clientId: string, raw: unknown, now: number): Outbound[] {
    const p = this.players.get(clientId);
    if (!p || !p.online) return [];
    if (!this.take(p, now)) return [];
    const out = this.advance(now);
    if (phaseAt(now, this.cfg.roundMs, this.cfg.overMs).phase !== 'playing') return out;

    const m = raw as { id?: unknown; pts?: unknown; end?: unknown } | null;
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

    const key = `${p.slot}:${m.id}`;
    const newStroke = p.curStroke !== m.id || !this.strokeIdx.has(key);
    let opIndex: number;
    let prev: Pt | null = null;
    if (newStroke) {
      opIndex = this.pushOp({ k: 's', id: m.id, pid: p.slot, pts: [] });
      this.strokeIdx.set(key, opIndex);
      p.curStroke = m.id;
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
    if (p.lastMsgAt && now - p.lastMsgAt < 500 && !newStroke) p.stats.drawMs += now - p.lastMsgAt;
    p.lastMsgAt = now;
    p.stats.overdraw += this.grid.stampPath(p.slot, path, BRUSH_RADIUS);
    this.scoresDirty = true;
    this.metaDirty = true;

    out.push({ to: { except: clientId }, msg: { t: 'stroke', id: m.id, pid: p.slot, pts: flat } });

    const mode = MODES[modeForRound(this.roundIdx, this.cfg.order)];
    for (const poly of mode.onPoints({ player: p, pts, newStroke })) this.applyFill(p, poly, out);

    if (m.end === true) p.curStroke = null;
    return out;
  }

  private applyFill(p: PlayerState, poly: Pt[], out: Outbound[]): void {
    const rounded = decimate(poly, 200).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
    const cells = this.grid.polygonCells(rounded);
    if (cells.length < MIN_FILL_CELLS || cells.length > MAX_FILL_SHARE * GRID_W * GRID_H) return;
    p.stats.overdraw += this.grid.setCells(p.slot, cells);
    const flat = rounded.flatMap((q) => [q.x, q.y]);
    this.pushOp({ k: 'f', pid: p.slot, poly: flat });
    out.push({ to: 'all', msg: { t: 'fill', pid: p.slot, poly: flat } });
  }

  // ---- clock -------------------------------------------------------------------

  tick(now: number): Outbound[] {
    const out = this.advance(now);
    if (this.scoresDirty) {
      this.scoresDirty = false;
      out.push({ to: 'all', msg: { t: 'scores', shares: this.grid.shares() } });
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
      });
      this.metaDirty = false;
    }
  }

  // ---- internals -----------------------------------------------------------------

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
    for (const p of this.players.values()) {
      p.trail.reset();
      p.curStroke = null;
    }
    this.store.pruneBefore(idx - HISTORY_LIMIT);
    this.metaDirty = true;
    this.flush();
  }

  private finalize(): void {
    this.finalized = true;
    this.flush();
    const shares = this.grid.shares();
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
    for (const p of this.players.values()) if (shares[p.slot] !== undefined) players[p.slot] = { name: p.name, color: p.color };
    const summary: RoundSummary = {
      idx: this.roundIdx,
      mode: modeForRound(this.roundIdx, this.cfg.order),
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
      this.players.set(pp.clientId, { ...pp, online: false, trail: new LoopTrail(), curStroke: null, lastMsgAt: 0, tokens: BUCKET_CAP, tokensAt: 0 });
    }
    this.roundIdx = meta.roundIdx;
    this.finalized = meta.finalized;
    this.ops = this.store.loadOpChunks(meta.roundIdx);
    for (const op of this.ops) {
      if (op.k === 's') {
        const pts: Pt[] = [];
        for (let i = 0; i < op.pts.length; i += 2) pts.push({ x: op.pts[i]!, y: op.pts[i + 1]! });
        this.grid.stampPath(op.pid, pts, BRUSH_RADIUS);
        this.opPoints += pts.length;
      } else {
        const poly: Pt[] = [];
        for (let i = 0; i < op.poly.length; i += 2) poly.push({ x: op.poly[i]!, y: op.poly[i + 1]! });
        this.grid.setCells(op.pid, this.grid.polygonCells(poly));
        this.opPoints += poly.length;
      }
    }
    if (this.finalized) {
      const shares = this.grid.shares();
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
      stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null,
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
    const mode = MODES[modeForRound(w.idx, this.cfg.order)];
    return { idx: w.idx, mode: mode.id, modeName: mode.name, rules: mode.rules, phase: w.phase, startsAt: w.startsAt, overAt: w.overAt, endsAt: w.endsAt };
  }

  private playerInfos(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ pid: p.slot, name: p.name, color: p.color, online: p.online, wins: p.wins }));
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
      shares: this.grid.shares(),
      history: this.history,
    };
  }
}

function persist(p: PlayerState): PersistedPlayer {
  return { clientId: p.clientId, slot: p.slot, name: p.name, color: p.color, wins: p.wins, lastSeen: p.lastSeen, stats: p.stats };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
