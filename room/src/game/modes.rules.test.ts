import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { MemoryStore } from '../store/memoryStore';
import { flagAt, hillAt, hotZones, inCircle, type ModeId, type ServerMsg } from '@gallery/shared';
import type { Outbound } from './types';

const ROUND = 100_000;
const OVER = 10_000;
const cfgFor = (mode: ModeId) => ({ roundMs: ROUND, overMs: OVER, order: [mode], password: '' });
const make = (mode: ModeId, now: number, store = new MemoryStore()) => new GameEngine(cfgFor(mode), store, now);
const id = (n: number) => `client-${String(n).padStart(4, '0')}`;
const stroke = (sid: string, pts: number[], end = true) => ({ t: 'stroke', id: sid, pts, end });
const of = <T extends ServerMsg['t']>(out: Outbound[], t: T) =>
  out.filter((o) => o.msg.t === t) as (Outbound & { msg: Extract<ServerMsg, { t: T }> })[];
const line = (x0: number, y0: number, x1: number, y1: number, n = 12) =>
  Array.from({ length: n }, (_, i) => [Math.round(x0 + ((x1 - x0) * i) / (n - 1)), Math.round(y0 + ((y1 - y0) * i) / (n - 1))]).flat();

describe('Hot Zones', () => {
  it('weights ground inside the zones 5x and ground outside less than plain territory', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const [z] = hotZones(0);
    // an inside stroke (centered in the first zone) and an equally long stroke far from every zone
    const far = [{ x: 60, y: 60 }, { x: 1540, y: 940 }, { x: 60, y: 940 }, { x: 1540, y: 60 }]
      .find((p) => hotZones(0).every((q) => !inCircle({ x: p.x + 60, y: p.y }, { ...q, r: q.r + 80 })))!;
    e.onStroke(id(1), stroke('a', line(z!.x - 60, z!.y, z!.x + 60, z!.y)), 1100);
    e.onStroke(id(2), stroke('b', line(far.x, far.y, far.x + 120, far.y)), 1100);
    const territoryA = e.grid.shares()[e.players.get(id(1))!.slot]!;
    const scores = of(e.tick(1200), 'scores')[0]!.msg.shares;
    const inside = scores[e.players.get(id(1))!.slot]!;
    const outside = scores[e.players.get(id(2))!.slot]!;
    expect(inside / territoryA).toBeGreaterThan(3);
    expect(inside / territoryA).toBeLessThan(4.2);
    expect(inside).toBeGreaterThan(outside);
  });
});

describe('Shrinking Zone', () => {
  it('lets you paint anywhere at the start of the round', () => {
    const e = make('shrink', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.onStroke(id(1), stroke('s', [10, 10, 40, 10]), 1100);
    const op = e.ops[0]!;
    expect(op.k === 's' ? op.pts : []).toEqual([10, 10, 40, 10]);
  });

  it('ignores points outside the ring late in the round and never paints them', () => {
    const e = make('shrink', 85_000);
    e.join(id(1), 'Ann', undefined, 85_000);
    // ring radius is about 195 at this time: x=800 and x=900 are inside, x=1000+ are outside
    e.onStroke(id(1), stroke('s', [800, 500, 900, 500, 1000, 500, 1200, 500, 1500, 500]), 85_100);
    const op = e.ops[0]!;
    expect(op.k === 's' ? op.pts : []).toEqual([800, 500, 900, 500]);
    expect(e.grid.cells[Math.floor(1200 / 4) + Math.floor(500 / 4) * 400]).toBe(0);
  });

  it('splits a stroke that leaves and re-enters the ring without connecting the gap', () => {
    const e = make('shrink', 85_000);
    e.join(id(1), 'Ann', undefined, 85_000);
    e.onStroke(id(1), stroke('s', [800, 500, 1100, 500, 850, 520]), 85_100);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(2);
    expect(e.grid.cells[Math.floor(1000 / 4) + Math.floor(500 / 4) * 400]).toBe(0);
  });

  it('draws nothing at all when every point is outside', () => {
    const e = make('shrink', 85_000);
    e.join(id(1), 'Ann', undefined, 85_000);
    e.onStroke(id(1), stroke('s', [20, 20, 60, 60]), 85_100);
    expect(e.ops.length).toBe(0);
  });
});

describe('King of the Hill', () => {
  it('counts only the ink laid on the current hill and blends it into the score', () => {
    const e = make('hill', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const hill = hillAt(0, 0, 1100);
    // Ann paints on the hill; Bob paints the same amount of ink far away from it
    const spot = [{ x: 100, y: 100 }, { x: 1500, y: 900 }, { x: 100, y: 900 }, { x: 1500, y: 100 }]
      .find((p) => !inCircle(p, { ...hill, r: hill.r + 150 }))!;
    e.onStroke(id(1), stroke('a', line(hill.x - 40, hill.y, hill.x + 40, hill.y, 6)), 1100);
    e.onStroke(id(2), stroke('b', line(spot.x, spot.y, spot.x + 80, spot.y, 6)), 1100);
    expect((e.modeState!.pts as Record<string, number>)[String(e.players.get(id(1))!.slot)]).toBe(6);
    expect((e.modeState!.pts as Record<string, number>)[String(e.players.get(id(2))!.slot)]).toBeUndefined();
    const out = e.tick(1200);
    const scores = of(out, 'scores')[0]!.msg.shares;
    const a = scores[e.players.get(id(1))!.slot]!;
    const b = scores[e.players.get(id(2))!.slot]!;
    expect(a).toBeGreaterThan(b + 0.35); // the 40% hill share all goes to Ann
  });

  it('stops counting a spot once the hill has moved away', () => {
    const e = make('hill', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    const first = hillAt(0, 0, 1000);
    e.onStroke(id(1), stroke('a', line(first.x - 40, first.y, first.x + 40, first.y, 6)), 1100);
    const before = JSON.stringify(e.modeState);
    // 11 s later the hill is somewhere else (the old spot no longer scores)
    const moved = hillAt(0, 0, 12_000);
    expect(inCircle({ x: first.x, y: first.y }, moved)).toBe(false);
    e.onStroke(id(1), stroke('b', line(first.x - 40, first.y + 20, first.x + 40, first.y + 20, 6)), 12_000);
    expect(JSON.stringify(e.modeState)).toBe(before);
  });

  it('keeps hill points across a server restart', () => {
    const store = new MemoryStore();
    const e = make('hill', 1000, store);
    e.join(id(1), 'Ann', undefined, 1000);
    const hill = hillAt(0, 0, 1100);
    e.onStroke(id(1), stroke('a', line(hill.x - 40, hill.y, hill.x + 40, hill.y, 6)), 1100);
    e.flush();
    const r = make('hill', 1500, store);
    expect(r.modeState).toEqual(e.modeState);
  });
});

describe('Capture the Flag', () => {
  // pick a round whose first two flag positions leave room for a 200 px loop around them
  const k = Array.from({ length: 400 }, (_, i) => i).find((i) => {
    const ok = (f: { x: number; y: number }) => f.x > 320 && f.x < 1280 && f.y > 320 && f.y < 680;
    return ok(flagAt(i, 0)) && ok(flagAt(i, 1));
  })!;
  const now0 = k * ROUND + 1000;
  const loopAround = (c: { x: number; y: number }) => [
    c.x - 150, c.y - 150, c.x + 150, c.y - 150, c.x + 150, c.y + 150, c.x - 150, c.y + 150, c.x, c.y - 250,
  ];

  it('captures the flag when a loop closes around it and respawns it elsewhere', () => {
    expect(k).toBeDefined();
    const e = make('ctf', now0);
    e.join(id(1), 'Ann', undefined, now0);
    expect(e.modeState).toEqual({ n: 0, caps: {} });
    e.onStroke(id(1), stroke('s', loopAround(flagAt(k, 0))), now0 + 100);
    const slot = e.players.get(id(1))!.slot;
    expect(e.modeState).toEqual({ n: 1, caps: { [slot]: 1 } });
    // the flag moved: a second loop around the NEW position captures again
    e.onStroke(id(1), stroke('t', loopAround(flagAt(k, 1))), now0 + 300);
    expect(e.modeState).toEqual({ n: 2, caps: { [slot]: 2 } });
  });

  it('does not capture when the loop misses the flag', () => {
    const e = make('ctf', now0);
    e.join(id(1), 'Ann', undefined, now0);
    const f = flagAt(k, 0);
    const away = { x: f.x < 800 ? f.x + 450 : f.x - 450, y: f.y };
    e.onStroke(id(1), stroke('s', loopAround(away)), now0 + 100);
    expect(e.ops.some((o) => o.k === 'f')).toBe(true); // the loop itself filled
    expect(e.modeState).toEqual({ n: 0, caps: {} });
  });

  it('adds 8% per capture to the capturer score', () => {
    const e = make('ctf', now0);
    e.join(id(1), 'Ann', undefined, now0);
    e.onStroke(id(1), stroke('s', loopAround(flagAt(k, 0))), now0 + 100);
    const slot = e.players.get(id(1))!.slot;
    const share = e.grid.shares()[slot]!;
    const score = of(e.tick(now0 + 200), 'scores')[0]!.msg.shares[slot]!;
    expect(score).toBeCloseTo(share + 0.08, 5);
  });
});
