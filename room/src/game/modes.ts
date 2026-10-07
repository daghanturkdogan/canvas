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
  /** Called about once a second while drawing is open (time-based points). */
  onTick?(ctx: { now: number; round: RoundRef; grid: OwnershipGrid; players: PlayerState[]; api: ModeApi }): void;
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

// ---- point-scoring helpers -----------------------------------------------------------------

const countMap = (v: unknown): Record<string, number> => ({ ...((v as Record<string, number> | undefined) ?? {}) });

/** A `{ slot: number }` map stored in the mode state, as numeric keys. */
function pointsFrom(state: ModeState | null, key = 'pts'): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [slot, n] of Object.entries(countMap(state?.[key]))) out[Number(slot)] = n;
  return out;
}

function addPoints(api: ModeApi, slot: number, n: number): void {
  if (!(n > 0)) return;
  const pts = countMap(api.state?.pts);
  pts[String(slot)] = (pts[String(slot)] ?? 0) + n;
  api.setState({ ...(api.state ?? {}), pts });
}

const inkLength = (pts: Pt[]): number => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return len;
};

/** Length of the line segments whose midpoint lies inside the circle. */
const inkInside = (pts: Pt[], c: { x: number; y: number; r: number }): number => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (inCircle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c)) len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
};

const INK_PER_POINT = 10;

// ---- Hot Zones: hold a zone to earn 5 points every second ------------------------------------

const ZONE_POINTS = 5;
const ZONE_MIN_CELLS = 15;

const hotzones: Mode = {
  ...plain('hotzones'),
  init: () => ({ pts: {} }),
  onTick({ round, grid, api }) {
    const pts = countMap(api.state?.pts);
    let changed = false;
    for (const z of hotZones(round.idx)) {
      const counts = new Map<number, number>();
      const gx0 = Math.max(0, Math.floor((z.x - z.r) / CELL)), gx1 = Math.min(GRID_W - 1, Math.floor((z.x + z.r) / CELL));
      const gy0 = Math.max(0, Math.floor((z.y - z.r) / CELL)), gy1 = Math.min(GRID_H - 1, Math.floor((z.y + z.r) / CELL));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (!inCircle({ x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 }, z)) continue;
          const owner = grid.cells[gy * GRID_W + gx]!;
          if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
        }
      }
      let best = 0, who = 0, tied = false;
      for (const [owner, n] of counts) {
        if (n > best) { best = n; who = owner; tied = false; } else if (n === best) tied = true;
      }
      if (who && !tied && best >= ZONE_MIN_CELLS) {
        pts[String(who)] = (pts[String(who)] ?? 0) + ZONE_POINTS;
        changed = true;
      }
    }
    if (changed) api.setState({ ...(api.state ?? {}), pts });
  },
  score: ({ state }) => pointsFrom(state),
};

// ---- Shrinking Zone: only the ring can be painted, and ink is worth more as it tightens -------

const shrink: Mode = {
  ...plain('shrink'),
  init: () => ({ pts: {} }),
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
  onPoints({ player, pts, now, round, api }) {
    const t = Math.min(1, Math.max(0, (now - round.startsAt) / (round.overAt - round.startsAt)));
    addPoints(api, player.slot, (inkLength(pts) / INK_PER_POINT) * (1 + 4 * t));
    return [];
  },
  score: ({ state }) => pointsFrom(state),
};

// ---- King of the Hill: ink laid on the moving hill earns points ---------------------------------

const hill: Mode = {
  ...plain('hill'),
  init: () => ({ pts: {} }),
  onPoints({ player, pts, now, round, api }) {
    addPoints(api, player.slot, inkInside(pts, hillAt(round.idx, round.startsAt, now)) / INK_PER_POINT);
    return [];
  },
  score: ({ state }) => pointsFrom(state),
};

// ---- Capture the Flag: Lasso. A capture is worth 100 points, every closed loop 5 ---------------

const CAPTURE_POINTS = 100;
const LOOP_POINTS = 5;

const ctf: Mode = {
  ...plain('ctf'),
  init: () => ({ n: 0, caps: {}, loops: {} }),
  onPoints: encloseOnPoints,
  onFill({ player, poly, round, api }) {
    const n = Number(api.state?.n ?? 0);
    const key = String(player.slot);
    const loops = countMap(api.state?.loops);
    loops[key] = (loops[key] ?? 0) + 1;
    const caps = countMap(api.state?.caps);
    if (pointInPolygon(flagAt(round.idx, n), poly)) {
      caps[key] = (caps[key] ?? 0) + 1;
      api.setState({ n: n + 1, caps, loops });
    } else {
      api.setState({ n, caps, loops });
    }
  },
  score({ state }) {
    const out: Record<number, number> = {};
    for (const [slot, n] of Object.entries(countMap(state?.caps))) out[Number(slot)] = (out[Number(slot)] ?? 0) + CAPTURE_POINTS * n;
    for (const [slot, n] of Object.entries(countMap(state?.loops))) out[Number(slot)] = (out[Number(slot)] ?? 0) + LOOP_POINTS * n;
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
