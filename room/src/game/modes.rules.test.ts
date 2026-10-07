import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { MemoryStore } from '../store/memoryStore';
import { PALETTE, TEAMS, flagAt, hillAt, hotZones, inCircle, type ModeId, type ServerMsg } from '@gallery/shared';
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
  /** Paint a block of ground (a few parallel lines) centered on (cx, cy). */
  const paintBlock = (e: GameEngine, who: string, sid: string, cx: number, cy: number, half: number, rows: number, now: number) => {
    for (let r = 0; r < rows; r++) {
      e.onStroke(who, stroke(`${sid}${r}`, line(cx - half, cy - 18 + r * 12, cx + half, cy - 18 + r * 12, 8)), now);
    }
  };
  const pointsOf = (e: GameEngine, n: number) =>
    Number((e.modeState!.pts as Record<string, number> | undefined)?.[String(e.players.get(id(n))!.slot)] ?? 0);
  const farFromZones = () => {
    const zones = hotZones(0);
    return [{ x: 60, y: 60 }, { x: 1540, y: 940 }, { x: 60, y: 940 }, { x: 1540, y: 60 }]
      .find((p) => zones.every((q) => !inCircle({ x: p.x + 60, y: p.y }, { ...q, r: q.r + 80 })))!;
  };

  it('awards 5 points every second to whoever owns the most ground inside a zone', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const [z] = hotZones(0);
    paintBlock(e, id(1), 'a', z!.x, z!.y, 60, 3, 1100); // Ann: a big block in the zone
    paintBlock(e, id(2), 'b', z!.x, z!.y + 70, 20, 1, 1100); // Bob: a small line in the same zone
    e.tick(2000); e.tick(3000); e.tick(4000);
    expect(pointsOf(e, 1)).toBe(15);
    expect(pointsOf(e, 2)).toBe(0);
  });

  it('moves the awards when the lead changes hands', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const [z] = hotZones(0);
    paintBlock(e, id(1), 'a', z!.x, z!.y, 40, 2, 1100);
    e.tick(2000);
    expect(pointsOf(e, 1)).toBe(5);
    paintBlock(e, id(2), 'b', z!.x, z!.y, 70, 4, 2100); // Bob paints over Ann and more
    e.tick(3000); e.tick(4000);
    expect(pointsOf(e, 1)).toBe(5);
    expect(pointsOf(e, 2)).toBe(10);
  });

  it('awards nothing for ground outside every zone or for a mere dot inside one', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const far = farFromZones();
    paintBlock(e, id(1), 'a', far.x + 60, far.y, 50, 3, 1100);
    e.onStroke(id(2), stroke('dot', [hotZones(0)[0]!.x, hotZones(0)[0]!.y]), 1100); // one dot: fewer than 15 cells
    e.tick(2000); e.tick(3000);
    expect(pointsOf(e, 1)).toBe(0);
    expect(pointsOf(e, 2)).toBe(0);
  });

  it('pays out each zone separately', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    for (const [i, z] of hotZones(0).entries()) paintBlock(e, id(1), `z${i}`, z.x, z.y, 40, 2, 1100);
    e.tick(2000);
    expect(pointsOf(e, 1)).toBe(15);
  });

  it('scores in points, not territory: huge territory outside the zones scores nothing', () => {
    const e = make('hotzones', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const far = farFromZones();
    paintBlock(e, id(2), 'big', far.x + 60, far.y, 50, 3, 1100);
    paintBlock(e, id(1), 'a', hotZones(0)[0]!.x, hotZones(0)[0]!.y, 30, 2, 1100);
    const scores = of(e.tick(2000), 'scores')[0]!.msg.shares;
    expect(scores[e.players.get(id(1))!.slot]).toBe(5);
    expect(scores[e.players.get(id(2))!.slot] ?? 0).toBe(0);
  });

  it('keeps its points across a server restart', () => {
    const store = new MemoryStore();
    const e = make('hotzones', 1000, store);
    e.join(id(1), 'Ann', undefined, 1000);
    paintBlock(e, id(1), 'a', hotZones(0)[0]!.x, hotZones(0)[0]!.y, 40, 2, 1100);
    e.tick(2000);
    e.flush();
    const r = make('hotzones', 2500, store);
    expect(r.modeState).toEqual(e.modeState);
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
  const offHill = (hill: { x: number; y: number; r: number }) =>
    [{ x: 100, y: 100 }, { x: 1500, y: 900 }, { x: 100, y: 900 }, { x: 1500, y: 100 }].find((p) => !inCircle(p, { ...hill, r: hill.r + 150 }))!;

  it('pays 1 point per 10 px of ink laid on the current hill and nothing for ink elsewhere', () => {
    const e = make('hill', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const hill = hillAt(0, 0, 1100);
    const spot = offHill(hill);
    e.onStroke(id(1), stroke('a', line(hill.x - 40, hill.y, hill.x + 40, hill.y, 6)), 1100); // 80 px on the hill
    e.onStroke(id(2), stroke('b', line(spot.x, spot.y, spot.x + 80, spot.y, 6)), 1100); // 80 px elsewhere
    const pts = e.modeState!.pts as Record<string, number>;
    expect(pts[String(e.players.get(id(1))!.slot)]).toBeCloseTo(8, 5);
    expect(pts[String(e.players.get(id(2))!.slot)]).toBeUndefined();
  });

  it('scores in points only: territory does not matter', () => {
    const e = make('hill', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    const hill = hillAt(0, 0, 1100);
    const spot = offHill(hill);
    e.onStroke(id(1), stroke('a', line(hill.x - 40, hill.y, hill.x + 40, hill.y, 6)), 1100);
    for (let r = 0; r < 4; r++) e.onStroke(id(2), stroke(`b${r}`, line(spot.x, spot.y + r * 14, spot.x + 400, spot.y + r * 14, 10)), 1100);
    const scores = of(e.tick(1200), 'scores')[0]!.msg.shares;
    expect(scores[e.players.get(id(1))!.slot]).toBeCloseTo(8, 5);
    expect(scores[e.players.get(id(2))!.slot] ?? 0).toBe(0);
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
    expect(e.modeState).toEqual({ n: 0, caps: {}, loops: {} });
    e.onStroke(id(1), stroke('s', loopAround(flagAt(k, 0))), now0 + 100);
    const slot = e.players.get(id(1))!.slot;
    expect(e.modeState).toEqual({ n: 1, caps: { [slot]: 1 }, loops: { [slot]: 1 } });
    // the flag moved: a second loop around the NEW position captures again
    e.onStroke(id(1), stroke('t', loopAround(flagAt(k, 1))), now0 + 300);
    expect(e.modeState).toEqual({ n: 2, caps: { [slot]: 2 }, loops: { [slot]: 2 } });
  });

  it('does not capture when the loop misses the flag', () => {
    const e = make('ctf', now0);
    e.join(id(1), 'Ann', undefined, now0);
    const f = flagAt(k, 0);
    const away = { x: f.x < 800 ? f.x + 450 : f.x - 450, y: f.y };
    e.onStroke(id(1), stroke('s', loopAround(away)), now0 + 100);
    expect(e.ops.some((o) => o.k === 'f')).toBe(true); // the loop itself filled
    expect(e.modeState).toEqual({ n: 0, caps: {}, loops: { [e.players.get(id(1))!.slot]: 1 } });
    const slot = e.players.get(id(1))!.slot;
    expect(of(e.tick(now0 + 200), 'scores')[0]!.msg.shares[slot]).toBe(5); // a loop that misses is worth 5
  });

  it('pays 100 points per capture and 5 per loop closed', () => {
    const e = make('ctf', now0);
    e.join(id(1), 'Ann', undefined, now0);
    e.onStroke(id(1), stroke('s', loopAround(flagAt(k, 0))), now0 + 100);
    const slot = e.players.get(id(1))!.slot;
    const score = of(e.tick(now0 + 200), 'scores')[0]!.msg.shares[slot]!;
    expect(score).toBe(105); // one capture (100) + one loop closed (5): territory does not count
  });
});

describe('Eraser Wars', () => {
  it('erases ownership with the wide brush when the stroke asks for it', () => {
    const e = make('eraser', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.join(id(2), 'Bob', undefined, 1000);
    e.onStroke(id(1), stroke('p', line(100, 200, 700, 200, 20)), 1100);
    const slot1 = e.players.get(id(1))!.slot;
    expect(e.grid.shares()[slot1]).toBeGreaterThan(0);
    e.onStroke(id(2), { t: 'stroke', id: 'x', pts: line(100, 200, 700, 200, 20), end: true, erase: true }, 1200);
    const eraseOp = e.ops[1]!;
    expect(eraseOp.k === 's' ? eraseOp.pid : -1).toBe(0);
    expect(e.grid.shares()[slot1] ?? 0).toBe(0); // the wide eraser (20) covers the thin line (6) completely
  });

  it('ignores the erase flag in modes that do not allow erasing', () => {
    const e = make('paint', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.onStroke(id(1), { t: 'stroke', id: 'x', pts: line(100, 200, 700, 200, 20), end: true, erase: true }, 1100);
    const op = e.ops[0]!;
    expect(op.k === 's' ? op.pid : -1).toBe(e.players.get(id(1))!.slot);
  });
});

describe('Team Tug-of-War', () => {
  /** An engine in a quiet round with `n` players online, advanced into a fresh teams round. */
  const startWith = (n: number) => {
    const e = make('teams', 1000);
    for (let i = 1; i <= n; i++) e.join(id(i), `P${i}`, undefined, 1000);
    e.tick(ROUND + 1000); // new round: teams are dealt for everyone online
    return e;
  };
  const teamOf = (e: GameEngine, n: number) => (e.modeState!.teams as Record<string, number>)[String(e.players.get(id(n))!.slot)]!;
  const sizes = (e: GameEngine) => {
    const counts: Record<number, number> = {};
    for (const t of Object.values(e.modeState!.teams as Record<string, number>)) counts[t] = (counts[t] ?? 0) + 1;
    return Object.values(counts).sort();
  };

  it('uses 2 teams for a small room and splits it evenly', () => {
    const e = startWith(8);
    expect(e.modeState!.count).toBe(2);
    expect(sizes(e)).toEqual([4, 4]);
  });

  it('uses more teams when more people are playing', () => {
    const e = startWith(12);
    expect(e.modeState!.count).toBe(4);
    expect(sizes(e)).toEqual([3, 3, 3, 3]);
  });

  it('puts a late joiner in the smallest team, and may open a new team as the room grows', () => {
    const e = startWith(8);
    e.join(id(9), 'P9', undefined, ROUND + 2000);
    expect(e.modeState!.count).toBe(3); // 9 players -> 3 teams
    expect(sizes(e)).toEqual([1, 4, 4]);
    e.join(id(10), 'P10', undefined, ROUND + 2100);
    expect(sizes(e)).toEqual([2, 4, 4]);
  });

  it('shows team colors from the team families, and tells clients their team', () => {
    const e = startWith(8);
    const w = of(e.join(id(1), 'P1', undefined, ROUND + 3000), 'welcome')[0]!.msg;
    for (const p of w.players.filter((q) => q.team !== undefined)) {
      expect(TEAMS[p.team!]!.shades).toContain(p.color);
    }
    const colors = new Set(w.players.map((p) => p.color));
    expect(colors.size).toBe(w.players.length); // still all different within the room
  });

  it('re-sends the player list when the round starts so clients recolor', () => {
    const e = make('teams', 1000);
    for (let i = 1; i <= 6; i++) e.join(id(i), `P${i}`, undefined, 1000);
    const out = e.tick(ROUND + 1000);
    const players = of(out, 'players').at(-1)!.msg.players;
    expect(players.every((p) => p.team !== undefined)).toBe(true);
  });

  it('scores a team as the sum of its members, and the winning team beats a bigger single painter', () => {
    const e = startWith(6);
    const t0 = teamOf(e, 1);
    const mates = [1, 2, 3, 4, 5, 6].filter((n) => teamOf(e, n) === t0);
    const rival = [1, 2, 3, 4, 5, 6].find((n) => teamOf(e, n) !== t0)!;
    const now = ROUND + 5000;
    // two teammates paint a 300 px line each; the rival paints one 400 px line (more than either teammate alone)
    e.onStroke(id(mates[0]!), stroke('a', line(100, 100, 400, 100, 8)), now);
    e.onStroke(id(mates[1]!), stroke('b', line(100, 200, 400, 200, 8)), now);
    e.onStroke(id(rival), stroke('c', line(100, 300, 500, 300, 8)), now);
    const scores = of(e.tick(now + 100), 'scores')[0]!.msg.shares;
    const slot = (n: number) => e.players.get(id(n))!.slot;
    expect(scores[slot(mates[0]!)]).toBeCloseTo(scores[slot(mates[1]!)]!, 8); // teammates share one score
    expect(scores[slot(mates[0]!)]!).toBeGreaterThan(scores[slot(rival)]!); // the team total beats the bigger single painter
    const over = of(e.tick(ROUND * 2 - 5000), 'round')[0]!.msg;
    expect(mates.map(slot)).toContain(over.winnerPid);
  });

  it('records team shades in the finished round so past rounds replay in team colors', () => {
    const e = startWith(6);
    e.onStroke(id(1), stroke('a', line(100, 100, 400, 100, 8)), ROUND + 5000);
    e.tick(ROUND * 2 - 5000);
    const summary = e.history.at(-1)!;
    const color = summary.players[e.players.get(id(1))!.slot]!.color;
    expect(TEAMS.flatMap((t) => t.shades)).toContain(color);
  });

  it('keeps the teams across a server restart', () => {
    const store = new MemoryStore();
    const e = make('teams', 1000, store);
    for (let i = 1; i <= 6; i++) e.join(id(i), `P${i}`, undefined, 1000);
    e.tick(ROUND + 1000);
    e.flush();
    const r = make('teams', ROUND + 1500, store);
    expect(r.modeState).toEqual(e.modeState);
  });
});

describe('leaving a team mode', () => {
  it('re-sends the player list at the start of the next round so team colors and teams are cleared', () => {
    const cfg = { roundMs: ROUND, overMs: OVER, order: ['teams', 'paint'] as ModeId[], password: '' };
    const e = new GameEngine(cfg, new MemoryStore(), 1000);
    for (let i = 1; i <= 6; i++) e.join(id(i), `P${i}`, undefined, 1000);
    const teamsRound = of(e.tick(ROUND * 2 + 1000), 'players').at(-1)!.msg.players; // idx 2 = teams again
    expect(teamsRound.every((p) => p.team !== undefined)).toBe(true);
    const paintRound = of(e.tick(ROUND * 3 + 1000), 'players').at(-1)!.msg.players; // idx 3 = paint
    expect(paintRound.every((p) => p.team === undefined)).toBe(true);
    // colors are back to the plain palette colors
    const palette = new Set(PALETTE);
    expect(paintRound.every((p) => palette.has(p.color))).toBe(true);
  });
});

describe('Shrinking Zone points', () => {
  const pts = (e: GameEngine, n: number) => Number((e.modeState!.pts as Record<string, number>)[String(e.players.get(id(n))!.slot)] ?? 0);

  it('pays about 1 point per 10 px of ink early in the round', () => {
    const e = make('shrink', 1000);
    e.join(id(1), 'Ann', undefined, 1000);
    e.onStroke(id(1), stroke('s', line(400, 500, 500, 500, 6)), 1100); // 100 px at the start of the round
    expect(pts(e, 1)).toBeGreaterThan(9.5);
    expect(pts(e, 1)).toBeLessThan(11.5);
  });

  it('pays up to 5x as the ring closes in', () => {
    const early = make('shrink', 1000);
    early.join(id(1), 'Ann', undefined, 1000);
    early.onStroke(id(1), stroke('a', line(780, 500, 840, 500, 6)), 1100);
    const late = make('shrink', 85_000);
    late.join(id(1), 'Ann', undefined, 85_000);
    late.onStroke(id(1), stroke('a', line(780, 500, 840, 500, 6)), 85_100);
    expect(pts(late, 1) / pts(early, 1)).toBeGreaterThan(4);
    expect(pts(late, 1) / pts(early, 1)).toBeLessThan(5.2);
  });

  it('scores in points: the scores message carries the points, not territory', () => {
    const e = make('shrink', 85_000);
    e.join(id(1), 'Ann', undefined, 85_000);
    e.onStroke(id(1), stroke('a', line(780, 500, 840, 500, 6)), 85_100);
    const scores = of(e.tick(85_200), 'scores')[0]!.msg.shares;
    expect(scores[e.players.get(id(1))!.slot]).toBeCloseTo(pts(e, 1), 5);
    expect(scores[e.players.get(id(1))!.slot]!).toBeGreaterThan(1);
  });

  it('pays nothing for ink outside the ring', () => {
    const e = make('shrink', 85_000);
    e.join(id(1), 'Ann', undefined, 85_000);
    e.onStroke(id(1), stroke('a', line(20, 20, 200, 20, 6)), 85_100);
    expect(e.modeState!.pts).toEqual({});
  });
});
