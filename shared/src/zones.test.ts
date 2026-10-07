import { describe, it, expect } from 'vitest';
import { hotZones, ringAt, hillAt, flagAt, inCircle } from './zones';
import { CANVAS_H, CANVAS_W } from './constants';

describe('hotZones', () => {
  it('returns 3 deterministic, non-overlapping circles inside the canvas', () => {
    for (let idx = 0; idx < 200; idx++) {
      const zones = hotZones(idx);
      expect(zones.length).toBe(3);
      expect(hotZones(idx)).toEqual(zones);
      for (const z of zones) {
        expect(z.x - z.r).toBeGreaterThanOrEqual(0);
        expect(z.x + z.r).toBeLessThanOrEqual(CANVAS_W);
        expect(z.y - z.r).toBeGreaterThanOrEqual(0);
        expect(z.y + z.r).toBeLessThanOrEqual(CANVAS_H);
      }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        expect(Math.hypot(zones[i]!.x - zones[j]!.x, zones[i]!.y - zones[j]!.y)).toBeGreaterThan(zones[i]!.r + zones[j]!.r);
      }
    }
  });

  it('differs between rounds', () => {
    expect(hotZones(1)).not.toEqual(hotZones(2));
  });
});

describe('ringAt', () => {
  const round = { startsAt: 1000, overAt: 11_000 };
  it('starts big enough to cover the whole canvas and ends small', () => {
    const a = ringAt(round, 1000);
    expect(a.r).toBeGreaterThanOrEqual(Math.hypot(CANVAS_W / 2, CANVAS_H / 2));
    expect(ringAt(round, 11_000).r).toBe(150);
  });

  it('shrinks monotonically and clamps outside the round', () => {
    let prev = Infinity;
    for (let t = 1000; t <= 11_000; t += 500) {
      const r = ringAt(round, t).r;
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
    expect(ringAt(round, 0).r).toBe(ringAt(round, 1000).r);
    expect(ringAt(round, 99_999).r).toBe(150);
  });

  it('is centered on the canvas', () => {
    const c = ringAt(round, 5000);
    expect(c.x).toBe(CANVAS_W / 2);
    expect(c.y).toBe(CANVAS_H / 2);
  });
});

describe('hillAt', () => {
  it('stays put inside a 10 second step and moves between steps', () => {
    const a = hillAt(5, 0, 1000);
    expect(hillAt(5, 0, 9000)).toEqual(a);
    expect(hillAt(5, 0, 11_000)).not.toEqual(a);
  });

  it('keeps the hill fully on the canvas', () => {
    for (let s = 0; s < 50; s++) {
      const h = hillAt(3, 0, s * 10_000);
      expect(h.x - h.r).toBeGreaterThanOrEqual(0);
      expect(h.x + h.r).toBeLessThanOrEqual(CANVAS_W);
      expect(h.y - h.r).toBeGreaterThanOrEqual(0);
      expect(h.y + h.r).toBeLessThanOrEqual(CANVAS_H);
    }
  });
});

describe('flagAt / inCircle', () => {
  it('is deterministic per (round, capture count) and moves after a capture', () => {
    expect(flagAt(4, 0)).toEqual(flagAt(4, 0));
    expect(flagAt(4, 1)).not.toEqual(flagAt(4, 0));
  });

  it('tests circle membership', () => {
    expect(inCircle({ x: 10, y: 10 }, { x: 10, y: 10, r: 1 })).toBe(true);
    expect(inCircle({ x: 20, y: 10 }, { x: 10, y: 10, r: 5 })).toBe(false);
  });
});
