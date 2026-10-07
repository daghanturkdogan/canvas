import type { ModeId } from './protocol';

export interface RoundWindow {
  idx: number;
  phase: 'playing' | 'over';
  startsAt: number;
  overAt: number;
  endsAt: number;
}

export function phaseAt(now: number, roundMs: number, overMs: number): RoundWindow {
  const idx = Math.floor(now / roundMs);
  const startsAt = idx * roundMs;
  const endsAt = startsAt + roundMs;
  const overAt = endsAt - overMs;
  return { idx, phase: now >= overAt ? 'over' : 'playing', startsAt, overAt, endsAt };
}

export function modeForRound(idx: number, order: readonly ModeId[]): ModeId {
  return order[idx % order.length]!;
}
