import { MODE_ORDER } from './constants';
import type { ModeId } from './protocol';
import { mulberry32 } from './rng';

/** Seeded shuffle of all modes for one "bag". */
function rawBag(bag: number, modes: readonly ModeId[]): ModeId[] {
  const rng = mulberry32((Math.imul(bag + 1, 2654435761) ^ 0x9e3779b9) >>> 0);
  const out = [...modes];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The order modes are played in during bag number `bag`. Every mode appears exactly once, so no mode
 * repeats before all others have played, and the first mode never equals the previous bag's last mode.
 */
export function bagOrder(bag: number, modes: readonly ModeId[] = MODE_ORDER): ModeId[] {
  const order = rawBag(bag, modes);
  if (bag > 0 && modes.length > 2) {
    const prevLast = rawBag(bag - 1, modes)[modes.length - 1]!; // the fix-up below only touches indices 0 and 1
    if (order[0] === prevLast) [order[0], order[1]] = [order[1]!, order[0]!];
  }
  return order;
}

/** The mode played in round `idx`: deterministic, random-looking, never back to back. */
export function scheduledMode(idx: number, modes: readonly ModeId[] = MODE_ORDER): ModeId {
  const n = modes.length;
  return bagOrder(Math.floor(idx / n), modes)[idx % n]!;
}
