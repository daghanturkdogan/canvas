import { describe, it, expect } from 'vitest';
import { LoopTrail } from './loops';
import { polygonArea } from './geometry';

const P = (x: number, y: number) => ({ x, y });

function feed(t: LoopTrail, pts: ReturnType<typeof P>[]) {
  t.beginStroke(pts[0]!);
  const polys = [];
  for (const p of pts.slice(1)) {
    const poly = t.push(p);
    if (poly) polys.push(poly);
  }
  return polys;
}

describe('LoopTrail', () => {
  it('returns nothing for a straight line', () => {
    expect(feed(new LoopTrail(), [P(0, 0), P(50, 0), P(100, 0)])).toEqual([]);
  });

  it('closes a loop when a stroke crosses itself', () => {
    const polys = feed(new LoopTrail(), [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)]);
    expect(polys.length).toBe(1);
    expect(polygonArea(polys[0]!)).toBeCloseTo(8333.33, 0);
  });

  it('closes a loop against an earlier stroke of the same player', () => {
    const t = new LoopTrail();
    feed(t, [P(0, 50), P(200, 50)]);
    const polys = feed(t, [P(100, 0), P(150, 0), P(150, 100), P(100, 100), P(100, 20)]);
    // second stroke crosses the first at (150,50) when moving (150,0)->(150,100)
    expect(polys.length).toBeGreaterThanOrEqual(1);
  });

  it('does not treat the bridge between two strokes as a line to cross', () => {
    const t = new LoopTrail();
    feed(t, [P(0, 0), P(10, 0)]);
    // new stroke starts far away; the straight bridge (10,0)->(500,500) must not count
    const polys = feed(t, [P(400, 0), P(400, 600)]);
    expect(polys).toEqual([]);
  });

  it('does not close on the immediately adjacent segment', () => {
    expect(feed(new LoopTrail(), [P(0, 0), P(10, 0), P(20, 0), P(30, 0)])).toEqual([]);
  });

  it('continues after a loop without re-triggering the same crossing', () => {
    const t = new LoopTrail();
    const first = feed(t, [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)]);
    expect(first.length).toBe(1);
    expect(t.push(P(60, -80))).toBeNull();
  });

  it('keeps memory bounded on very long strokes', () => {
    const t = new LoopTrail();
    t.beginStroke(P(0, 0));
    for (let i = 1; i < 20000; i++) t.push(P(i, 0));
    expect(t.size()).toBeLessThanOrEqual(3000);
  });
});
