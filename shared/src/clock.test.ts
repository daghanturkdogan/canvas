import { describe, it, expect } from 'vitest';
import { phaseAt, modeForRound } from './clock';

describe('phaseAt', () => {
  const R = 1000, O = 100;
  it('is playing at the start of a round', () => {
    expect(phaseAt(2000, R, O)).toEqual({ idx: 2, phase: 'playing', startsAt: 2000, overAt: 2900, endsAt: 3000 });
  });
  it('is playing just before over', () => {
    expect(phaseAt(2899, R, O).phase).toBe('playing');
  });
  it('is over from overAt until the end', () => {
    expect(phaseAt(2900, R, O).phase).toBe('over');
    expect(phaseAt(2999, R, O).phase).toBe('over');
  });
  it('starts the next round exactly at endsAt', () => {
    const w = phaseAt(3000, R, O);
    expect(w.idx).toBe(3);
    expect(w.phase).toBe('playing');
  });
});

describe('modeForRound', () => {
  it('cycles through the order', () => {
    const order = ['paint', 'enclose'] as const;
    expect(modeForRound(0, order)).toBe('paint');
    expect(modeForRound(1, order)).toBe('enclose');
    expect(modeForRound(2, order)).toBe('paint');
    expect(modeForRound(970001, order)).toBe('enclose');
  });
});
