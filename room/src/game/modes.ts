import type { ModeId } from '@gallery/shared';
import type { Pt } from './geometry';
import type { PlayerState } from './types';

export interface ModeCtx { player: PlayerState; pts: Pt[]; newStroke: boolean }

export interface Mode {
  id: ModeId;
  name: string;
  rules: string;
  /** Called with newly received points; returns polygons that should be filled with the player's color. */
  onPoints(ctx: ModeCtx): Pt[][];
}

const paint: Mode = {
  id: 'paint',
  name: 'Paint War',
  rules: 'Cover as much of the canvas as you can. Paint over others to steal their ground.',
  onPoints: () => [],
};

const enclose: Mode = {
  id: 'enclose',
  name: 'Lasso',
  rules: 'Draw a line that loops back and crosses your own line. The loop fills with your color.',
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

export const MODES: Record<ModeId, Mode> = { paint, enclose };
