import { describe, it, expect } from 'vitest';
import { bagOrder, scheduledMode } from './schedule';
import { MODE_ORDER } from './constants';
import { nextModeInfo } from './modes';

describe('bagOrder', () => {
  it('contains every mode exactly once', () => {
    for (let bag = 0; bag < 50; bag++) {
      const order = bagOrder(bag);
      expect([...order].sort()).toEqual([...MODE_ORDER].sort());
    }
  });

  it('is deterministic', () => {
    expect(bagOrder(7)).toEqual(bagOrder(7));
  });

  it('differs between bags (it is a shuffle, not a fixed rotation)', () => {
    const distinct = new Set(Array.from({ length: 20 }, (_, b) => bagOrder(b).join(',')));
    expect(distinct.size).toBeGreaterThan(10);
  });
});

describe('scheduledMode', () => {
  it('never repeats a mode back to back, even across bag boundaries', () => {
    let prev = scheduledMode(0);
    for (let i = 1; i < 2000; i++) {
      const cur = scheduledMode(i);
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it('plays every mode once before any mode repeats', () => {
    const n = MODE_ORDER.length;
    for (let bag = 0; bag < 20; bag++) {
      const seen = new Set(Array.from({ length: n }, (_, k) => scheduledMode(bag * n + k)));
      expect(seen.size).toBe(n);
    }
  });

  it('matches what the Up next panel announces', () => {
    for (let i = 0; i < 100; i++) expect(nextModeInfo(i).mode).toBe(scheduledMode(i + 1));
  });
});
