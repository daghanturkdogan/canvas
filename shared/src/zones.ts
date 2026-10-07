import { CANVAS_H, CANVAS_W } from './constants';
import { mulberry32 } from './rng';

export interface Circle { x: number; y: number; r: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function inCircle(p: { x: number; y: number }, c: Circle): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r;
}

export const ZONE_RADIUS = 140;
export const HILL_RADIUS = 150;
export const HILL_STEP_MS = 10_000;
export const FLAG_RADIUS = 70;
export const RING_START = 960;
export const RING_END = 150;

/** Three non-overlapping scoring zones, fixed for the whole round. */
export function hotZones(roundIdx: number): Circle[] {
  const rng = mulberry32(Math.imul(roundIdx + 1, 7919) >>> 0);
  const zones: Circle[] = [];
  let guard = 0;
  while (zones.length < 3 && guard++ < 500) {
    const c = {
      x: Math.round(ZONE_RADIUS + rng() * (CANVAS_W - 2 * ZONE_RADIUS)),
      y: Math.round(ZONE_RADIUS + rng() * (CANVAS_H - 2 * ZONE_RADIUS)),
      r: ZONE_RADIUS,
    };
    if (zones.every((z) => Math.hypot(z.x - c.x, z.y - c.y) > z.r + c.r + 20)) zones.push(c);
  }
  return zones;
}

/** The shrinking safe area; players may only draw inside it. */
export function ringAt(round: { startsAt: number; overAt: number }, now: number): Circle {
  const t = clamp((now - round.startsAt) / (round.overAt - round.startsAt), 0, 1);
  return { x: CANVAS_W / 2, y: CANVAS_H / 2, r: Math.round(RING_START + (RING_END - RING_START) * t) };
}

/** The hill jumps to a new seeded position every HILL_STEP_MS. */
export function hillAt(roundIdx: number, startsAt: number, now: number): Circle {
  const step = Math.floor(Math.max(0, now - startsAt) / HILL_STEP_MS);
  const rng = mulberry32((Math.imul(roundIdx + 1, 104729) + Math.imul(step + 1, 31) + 7) >>> 0);
  return {
    x: Math.round(HILL_RADIUS + rng() * (CANVAS_W - 2 * HILL_RADIUS)),
    y: Math.round(HILL_RADIUS + rng() * (CANVAS_H - 2 * HILL_RADIUS)),
    r: HILL_RADIUS,
  };
}

/** Where the flag is after `captures` captures in this round. */
export function flagAt(roundIdx: number, captures: number): Circle {
  const rng = mulberry32((Math.imul(roundIdx + 1, 15485863) + Math.imul(captures + 1, 97) + 3) >>> 0);
  return {
    x: Math.round(150 + rng() * (CANVAS_W - 300)),
    y: Math.round(150 + rng() * (CANVAS_H - 300)),
    r: FLAG_RADIUS,
  };
}
