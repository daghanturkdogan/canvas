import { MODE_DEFS, type ModeDef, type ModeId, type ModeState, type PlayerInfo } from '@gallery/shared';
import type { Pt } from './geometry';
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

export const MODES: Record<ModeId, Mode> = {
  paint,
  splat,
  hotzones: plain('hotzones'),
  hill: plain('hill'),
  enclose,
  ctf: { ...plain('ctf'), onPoints: encloseOnPoints },
  fog: plain('fog'),
  eraser: plain('eraser'),
  shrink: plain('shrink'),
  teams: plain('teams'),
};

export interface ModeEntry { def: ModeDef; rules: Mode }

export const REGISTRY = Object.fromEntries(
  (Object.keys(MODES) as ModeId[]).map((id) => [id, { def: MODE_DEFS[id], rules: MODES[id] }]),
) as Record<ModeId, ModeEntry>;
