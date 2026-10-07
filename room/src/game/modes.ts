import { MODE_DEFS, type ModeDef, type ModeId, type ModeState } from '@gallery/shared';
import type { Pt } from './geometry';
import type { OwnershipGrid } from './ownership';
import type { PlayerState } from './types';

export interface ModeCtx { player: PlayerState; pts: Pt[]; newStroke: boolean }

export interface Mode {
  id: ModeId;
  name: string;
  rules: string;
  /** Strokes erase ownership instead of painting it (stored with pid 0). */
  erases?: boolean;
  /** Per-round state created at round start (kept by the engine, sent to clients). */
  init?(ctx: { roundIdx: number }): ModeState | null;
  /** Split incoming points into allowed runs. Must return the SAME point objects it was given. */
  filterPoints?(ctx: { player: PlayerState; pts: Pt[]; now: number; roundIdx: number }): Pt[][];
  /** Called with newly received points; returns polygons that should be filled with the player's color. */
  onPoints(ctx: ModeCtx): Pt[][];
  /** Score per player slot (fraction 0..1). Defaults to territory share. */
  score?(ctx: { grid: OwnershipGrid; players: PlayerState[] }): Record<number, number>;
}

const paint: Mode = {
  id: 'paint',
  name: 'Paint War',
  rules: MODE_DEFS.paint.rules,
  onPoints: () => [],
};

const splat: Mode = {
  id: 'splat',
  name: 'Splat',
  rules: MODE_DEFS.splat.rules,
  onPoints: () => [],
};

const enclose: Mode = {
  id: 'enclose',
  name: 'Lasso',
  rules: MODE_DEFS.enclose.rules,
  onPoints({ player, pts, newStroke }) {
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
  },
};

export const MODES: Record<ModeId, Mode> = { paint, splat, enclose };

export interface ModeEntry { def: ModeDef; rules: Mode }

export const REGISTRY: Record<ModeId, ModeEntry> = {
  paint: { def: MODE_DEFS.paint, rules: paint },
  splat: { def: MODE_DEFS.splat, rules: splat },
  enclose: { def: MODE_DEFS.enclose, rules: enclose },
};
