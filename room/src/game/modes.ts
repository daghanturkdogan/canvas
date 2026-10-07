import {
  CELL, GRID_H, GRID_W, MODE_DEFS, flagAt, hillAt, hotZones, inCircle, mulberry32, ringAt, teamCountFor, teamShade,
  type ModeDef, type ModeId, type ModeState, type PlayerInfo,
} from '@gallery/shared';
import { pointInPolygon, type Pt } from './geometry';
import type { OwnershipGrid } from './ownership';
import type { PlayerState } from './types';

export interface ModeApi {
  /** The current per-round state. */
  readonly state: ModeState | null;
  setState(next: ModeState | null): void;
}

export interface RoundRef { idx: number; startsAt: number; overAt: number }

export interface ModeCtx {
  player: PlayerState;
  pts: Pt[];
  newStroke: boolean;
  now: number;
  round: RoundRef;
  api: ModeApi;
}

export interface Mode {
  id: ModeId;
  name: string;
  rules: string;
  /** Every stroke erases ownership instead of painting it (stored with pid 0). */
  erases?: boolean;
  /** Players may erase by sending `erase: true` with a stroke (stored with pid 0, wider brush). */
  allowsErase?: boolean;
  /** Per-round state created at round start (kept by the engine, sent to clients). */
  init?(ctx: { roundIdx: number; players: PlayerState[] }): ModeState | null;
  /** A player joined (or rejoined) the room during this round. */
  onJoin?(ctx: { player: PlayerState; players: PlayerState[]; now: number; round: RoundRef; api: ModeApi }): void;
  /** Split incoming points into allowed runs. Must return the SAME point objects it was given. */
  filterPoints?(ctx: { player: PlayerState; pts: Pt[]; now: number; roundIdx: number; round: RoundRef; api: ModeApi }): Pt[][];
  /** Called with newly received points; returns polygons that should be filled with the player's color. */
  onPoints(ctx: ModeCtx): Pt[][];
  /** A fill polygon was applied for `player`. */
  onFill?(ctx: { player: PlayerState; poly: Pt[]; now: number; round: RoundRef; api: ModeApi }): void;
  /** Score per player slot (fraction-like). Defaults to territory share. */
  score?(ctx: { grid: OwnershipGrid; players: PlayerState[]; state: ModeState | null; roundIdx: number }): Record<number, number>;
  /** Per-mode view of a player (team, team color). */
  playerInfo?(info: PlayerInfo, ctx: { state: ModeState | null; players: PlayerState[]; roundIdx: number }): PlayerInfo;
}

const encloseOnPoints: Mode['onPoints'] = ({ player, pts, newStroke }) => {
  const polys: Pt[][] = [];
  pts.forEach((pt, i) => {
    if (newStroke && i === 0) {
      player.trail.beginStroke(pt);
      return;
    }
    const poly = player.trail.push(pt);
    if (poly) polys.push(poly);
  });
  return polys;
};

/** Behavior-free rules for a mode id; used for modes whose logic is just the shared definition. */
const plain = (id: ModeId): Mode => ({ id, name: MODE_DEFS[id].name, rules: MODE_DEFS[id].rules, onPoints: () => [] });

const paint = plain('paint');
const splat = plain('splat');

const enclose: Mode = { ...plain('enclose'), onPoints: encloseOnPoints };

// ---- Hot Zones: ground inside the three zones counts 5x ---------------------------------------

let zoneMaskFor = -1;
let zoneMask: Uint8Array | null = null;
function hotZoneMask(roundIdx: number): Uint8Array {
  if (zoneMask && zoneMaskFor === roundIdx) return zoneMask;
  const zones = hotZones(roundIdx);
  const mask = new Uint8Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const c = { x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 };
      if (zones.some((z) => inCircle(c, z))) mask[gy * GRID_W + gx] = 1;
    }
  }
  zoneMask = mask;
  zoneMaskFor = roundIdx;
  return mask;
}

const hotzones: Mode = {
  ...plain('hotzones'),
  score({ grid, roundIdx }) {
    const mask = hotZoneMask(roundIdx);
    const weights = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      const w = mask[i] ? 5 : 1;
      total += w;
      const owner = grid.cells[i]!;
      if (owner) weights.set(owner, (weights.get(owner) ?? 0) + w);
    }
    const out: Record<number, number> = {};
    for (const [owner, w] of weights) out[owner] = w / total;
    return out;
  },
};

// ---- Shrinking Zone: only the area inside the shrinking ring can be painted ------------------

const shrink: Mode = {
  ...plain('shrink'),
  filterPoints({ pts, now, round }) {
    const ring = ringAt(round, now);
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    for (const p of pts) {
      if (inCircle(p, ring)) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs;
  },
};

// ---- King of the Hill: ink laid on the moving hill earns hill points -------------------------

const countMap = (v: unknown): Record<string, number> => ({ ...((v as Record<string, number> | undefined) ?? {}) });

const hill: Mode = {
  ...plain('hill'),
  init: () => ({ pts: {} }),
  onPoints({ player, pts, now, round, api }) {
    const h = hillAt(round.idx, round.startsAt, now);
    const inside = pts.filter((p) => inCircle(p, h)).length;
    if (inside > 0) {
      const mine = countMap(api.state?.pts);
      mine[String(player.slot)] = (mine[String(player.slot)] ?? 0) + inside;
      api.setState({ pts: mine });
    }
    return [];
  },
  score({ grid, state }) {
    const shares = grid.shares();
    const hillPts = countMap(state?.pts);
    const total = Object.values(hillPts).reduce((a, b) => a + b, 0);
    const out: Record<number, number> = {};
    for (const [owner, share] of Object.entries(shares)) out[Number(owner)] = 0.6 * share;
    if (total > 0) {
      for (const [owner, n] of Object.entries(hillPts)) out[Number(owner)] = (out[Number(owner)] ?? 0) + (0.4 * n) / total;
    }
    return out;
  },
};

// ---- Capture the Flag: Lasso, plus a flag that a closed loop can capture ---------------------

const ctf: Mode = {
  ...plain('ctf'),
  init: () => ({ n: 0, caps: {} }),
  onPoints: encloseOnPoints,
  onFill({ player, poly, round, api }) {
    const n = Number(api.state?.n ?? 0);
    if (!pointInPolygon(flagAt(round.idx, n), poly)) return;
    const caps = countMap(api.state?.caps);
    caps[String(player.slot)] = (caps[String(player.slot)] ?? 0) + 1;
    api.setState({ n: n + 1, caps });
  },
  score({ grid, state }) {
    const out: Record<number, number> = { ...grid.shares() };
    for (const [owner, n] of Object.entries(countMap(state?.caps))) out[Number(owner)] = (out[Number(owner)] ?? 0) + 0.08 * n;
    return out;
  },
};

// ---- Eraser Wars: paint, or erase with a wide brush ------------------------------------------

const eraser: Mode = { ...plain('eraser'), allowsErase: true };

// ---- Team Tug-of-War: players are dealt into teams, scored as a team --------------------------

interface TeamState { teams: Record<string, number>; count: number }

const teamState = (state: ModeState | null | undefined): TeamState => ({
  teams: { ...((state?.teams as Record<string, number> | undefined) ?? {}) },
  count: Number(state?.count ?? 2),
});

const teamSizes = (st: TeamState): number[] => {
  const sizes = Array.from({ length: st.count }, () => 0);
  for (const t of Object.values(st.teams)) if (t < sizes.length) sizes[t]!++;
  return sizes;
};

const teams: Mode = {
  ...plain('teams'),
  init({ roundIdx, players }) {
    const count = teamCountFor(players.length);
    const order = players.map((p) => p.slot).sort((a, b) => a - b);
    const rng = mulberry32(Math.imul(roundIdx + 1, 2246822519) >>> 0);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const assigned: Record<string, number> = {};
    order.forEach((slot, i) => { assigned[String(slot)] = i % count; });
    return { teams: assigned, count };
  },
  onJoin({ player, players, api }) {
    const st = teamState(api.state);
    if (st.teams[String(player.slot)] !== undefined) return;
    const online = players.filter((p) => p.online).length;
    st.count = Math.max(st.count, teamCountFor(online));
    const sizes = teamSizes(st);
    const smallest = sizes.indexOf(Math.min(...sizes));
    st.teams[String(player.slot)] = smallest;
    api.setState({ teams: st.teams, count: st.count });
  },
  playerInfo(info, { state }) {
    const st = teamState(state);
    const team = st.teams[String(info.pid)];
    if (team === undefined) return info;
    const mates = Object.entries(st.teams).filter(([, t]) => t === team).map(([slot]) => Number(slot)).sort((a, b) => a - b);
    return { ...info, team, color: teamShade(team, mates.indexOf(info.pid)) };
  },
  score({ grid, state }) {
    const st = teamState(state);
    const shares = grid.shares();
    const totals: Record<number, number> = {};
    for (const [slot, team] of Object.entries(st.teams)) totals[team] = (totals[team] ?? 0) + (shares[Number(slot)] ?? 0);
    const out: Record<number, number> = {};
    for (const [slot, team] of Object.entries(st.teams)) out[Number(slot)] = totals[team] ?? 0;
    for (const [owner, share] of Object.entries(shares)) if (out[Number(owner)] === undefined) out[Number(owner)] = share;
    return out;
  },
};

export const MODES: Record<ModeId, Mode> = {
  paint,
  splat,
  hotzones,
  hill,
  enclose,
  ctf,
  fog: plain('fog'),
  eraser,
  shrink,
  teams,
};

export interface ModeEntry { def: ModeDef; rules: Mode }

export const REGISTRY = Object.fromEntries(
  (Object.keys(MODES) as ModeId[]).map((id) => [id, { def: MODE_DEFS[id], rules: MODES[id] }]),
) as Record<ModeId, ModeEntry>;
