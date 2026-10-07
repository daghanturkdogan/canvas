export type ScoreUnit = 'percent' | 'points';

/** Territory scores are fractions of the canvas; point scores are plain numbers. */
export function formatScore(value: number, unit: ScoreUnit): string {
  if (unit === 'points') {
    const n = Math.round(value);
    return n === 1 ? '1 pt' : `${n} pts`;
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function scoreTitle(unit: ScoreUnit): string {
  return unit === 'points' ? 'Points' : 'Territory';
}
