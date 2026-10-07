import { describe, it, expect } from 'vitest';
import { formatScore, scoreTitle } from './score';

describe('formatScore', () => {
  it('shows territory as a percentage with one decimal', () => {
    expect(formatScore(0.1234, 'percent')).toBe('12.3%');
    expect(formatScore(0, 'percent')).toBe('0.0%');
  });

  it('shows points as rounded whole points', () => {
    expect(formatScore(412.6, 'points')).toBe('413 pts');
    expect(formatScore(0, 'points')).toBe('0 pts');
  });

  it('uses the singular for exactly one point', () => {
    expect(formatScore(1, 'points')).toBe('1 pt');
    expect(formatScore(0.7, 'points')).toBe('1 pt');
  });
});

describe('scoreTitle', () => {
  it('names the leaderboard after what is being counted', () => {
    expect(scoreTitle('points')).toBe('Points');
    expect(scoreTitle('percent')).toBe('Territory');
  });
});
