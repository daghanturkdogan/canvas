import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { MemoryStore } from '../store/memoryStore';
import { MODE_DEFS, PALETTE, type ModeId, type ServerMsg } from '@gallery/shared';
import type { ModeEntry } from './modes';
import type { Pt } from './geometry';
import type { Outbound } from './types';

const cfg = { roundMs: 1000, overMs: 100, order: ['paint', 'enclose'] as ModeId[], password: '' };
const mk = (now = 0, store = new MemoryStore(), c = cfg) => new GameEngine(c, store, now);
const of = <T extends ServerMsg['t']>(out: Outbound[], t: T) =>
  out.filter((o) => o.msg.t === t) as (Outbound & { msg: Extract<ServerMsg, { t: T }> })[];
const id = (n: number) => `client-${String(n).padStart(4, '0')}`;
const stroke = (sid: string, pts: number[], end = false) => ({ t: 'stroke', id: sid, pts, end });

describe('join', () => {
  it('assigns distinct colors and welcomes the joiner', () => {
    const e = mk();
    const a = e.join(id(1), 'Ann', undefined, 0);
    const b = e.join(id(2), 'Bob', undefined, 0);
    const wa = of(a, 'welcome')[0]!;
    const wb = of(b, 'welcome')[0]!;
    expect(wa.to).toEqual({ only: id(1) });
    expect(wa.msg.you).not.toBe(wb.msg.you);
    expect(of(b, 'players')[0]!.msg.players.map((p) => p.color).length).toBe(2);
    expect(new Set(of(b, 'players')[0]!.msg.players.map((p) => p.color)).size).toBe(2);
  });

  it('keeps slot and color when the same clientId rejoins', () => {
    const e = mk();
    const first = of(e.join(id(1), 'Ann', undefined, 0), 'welcome')[0]!.msg.you;
    e.disconnect(id(1), 10);
    const again = of(e.join(id(1), 'Ann', undefined, 20), 'welcome')[0]!.msg.you;
    expect(again).toBe(first);
    expect(e.players.size).toBe(1);
  });

  it('rejects a wrong password', () => {
    const e = mk(0, new MemoryStore(), { ...cfg, password: 'secret' });
    expect(of(e.join(id(1), 'Ann', 'nope', 0), 'error')[0]!.msg.reason).toBe('bad-password');
    expect(of(e.join(id(1), 'Ann', 'secret', 0), 'welcome').length).toBe(1);
  });

  it('rejects an invalid clientId', () => {
    const e = mk();
    expect(of(e.join('x', 'Ann', undefined, 0), 'error')[0]!.msg.reason).toBe('bad-join');
  });

  it('reports room-full when every slot has an online player', () => {
    const e = mk();
    for (let i = 0; i < PALETTE.length; i++) e.join(id(i), `P${i}`, undefined, 0);
    expect(of(e.join(id(99), 'Late', undefined, 0), 'error')[0]!.msg.reason).toBe('room-full');
  });

  it('sanitizes names', () => {
    const e = mk();
    e.join(id(1), '  <b>Ann</b>\u0007   the   Great and Powerful Indeed  ', undefined, 0);
    const name = e.players.get(id(1))!.name;
    expect(name).not.toMatch(/[<>\u0007]/);
    expect(name.length).toBeLessThanOrEqual(20);
    e.join(id(2), '   ', undefined, 0);
    expect(e.players.get(id(2))!.name).toBe('Anonymous');
    e.join(id(3), 12345 as unknown, undefined, 0);
    expect(e.players.get(id(3))!.name).toBe('Anonymous');
  });
});

describe('strokes (paint mode, idx 0)', () => {
  it('applies a stroke, broadcasts to others, updates scores on tick', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    const out = e.onStroke(id(1), stroke('s1', [100, 100, 200, 100]), 100);
    const msg = of(out, 'stroke')[0]!;
    expect(msg.to).toEqual({ except: id(1) });
    expect(msg.msg.pts).toEqual([100, 100, 200, 100]);
    const scores = of(e.tick(150), 'scores')[0]!.msg.shares;
    expect(Object.values(scores)[0]).toBeGreaterThan(0);
  });

  it('counts overdraw when painting over someone', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    e.onStroke(id(1), stroke('a', [100, 100, 300, 100], true), 10);
    e.onStroke(id(2), stroke('b', [100, 100, 300, 100], true), 500);
    expect(e.players.get(id(2))!.stats.overdraw).toBeGreaterThan(0);
    expect(e.players.get(id(2))!.stats.ink).toBeGreaterThan(0);
  });

  it('ignores malformed and hostile strokes without throwing', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    const bad: unknown[] = [
      null, 'str', 5, {}, { t: 'stroke' }, stroke('s', []), stroke('s', [1]), stroke('s', [1, 2, 3]),
      stroke('s', [NaN, 1]), stroke('s', [Infinity, 1]), { t: 'stroke', id: 5, pts: [1, 2] },
      { t: 'stroke', id: 's', pts: 'abc' }, { t: 'stroke', id: 's', pts: ['a', 'b'] },
      stroke('s', new Array(5000).fill(10)), stroke('x'.repeat(500), [1, 2]),
    ];
    for (const m of bad) expect(() => e.onStroke(id(1), m, 100)).not.toThrow();
    expect(e.ops.length).toBe(0);
    expect(Object.keys(e.grid.shares()).length).toBe(0);
  });

  it('clamps out-of-bounds coordinates into the canvas', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [-500, -500, 99999, 99999]), 100);
    const op = e.ops[0]!;
    expect(op.k).toBe('s');
    if (op.k === 's') {
      for (const v of op.pts) expect(v).toBeGreaterThanOrEqual(0);
      expect(Math.max(...op.pts)).toBeLessThanOrEqual(1600);
    }
  });

  it('ignores strokes from unknown or offline players', () => {
    const e = mk();
    expect(e.onStroke(id(5), stroke('s', [1, 2]), 100)).toEqual([]);
    e.join(id(1), 'Ann', undefined, 0);
    e.disconnect(id(1), 10);
    expect(e.onStroke(id(1), stroke('s', [1, 2]), 100)).toEqual([]);
  });

  it('rate limits floods', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    for (let i = 0; i < 300; i++) e.onStroke(id(1), stroke('s', [10, 10, 20, 20]), 100);
    const op = e.ops[0]!;
    // each accepted batch adds 4 numbers; the token bucket allows ~40 in the same millisecond
    expect(op.k === 's' ? op.pts.length / 4 : 0).toBeLessThanOrEqual(41);
    expect(op.k === 's' ? op.pts.length / 4 : 0).toBeGreaterThan(0);
  });
});

describe('enclose mode (idx 1)', () => {
  const loop = [400, 400, 600, 400, 600, 600, 400, 600, 500, 300];

  it('fills a closed loop and broadcasts the fill to everyone', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const out = e.onStroke(id(1), stroke('s', loop), 1250);
    const fill = of(out, 'fill')[0]!;
    expect(fill.to).toBe('all');
    expect(e.ops.some((o) => o.k === 'f')).toBe(true);
    const share = Object.values(e.grid.shares())[0]!;
    expect(share).toBeGreaterThan(0.01);
  });

  it('rejects a fill covering more than half the canvas', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const huge = [10, 10, 1590, 10, 1590, 990, 10, 990, 800, 5];
    const out = e.onStroke(id(1), stroke('s', huge), 1250);
    expect(of(out, 'fill').length).toBe(0);
  });

  it('rejects a tiny fill', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const tiny = [400, 400, 404, 400, 404, 404, 400, 404, 402, 398];
    expect(of(e.onStroke(id(1), stroke('s', tiny), 1250), 'fill').length).toBe(0);
  });
});

describe('round lifecycle', () => {
  it('finalizes at the over phase, announces a winner, then wipes on the next round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);

    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.round.phase).toBe('over');
    expect(over.winnerPid).toBe(e.players.get(id(1))!.slot);
    expect(over.wipe).toBe(false);
    expect(over.history.length).toBe(1);
    expect(e.players.get(id(1))!.wins).toBe(1);

    expect(e.onStroke(id(1), stroke('t', [1, 1, 50, 50]), 960)).toEqual([]); // over phase

    const next = of(e.tick(1000), 'round')[0]!.msg;
    expect(next.round.idx).toBe(1);
    expect(next.round.mode).toBe('enclose');
    expect(next.wipe).toBe(true);
    expect(e.ops.length).toBe(0);
    expect(e.grid.shares()).toEqual({});
  });

  it('does not leak an in-flight stroke into the next round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 200, 100]), 800);
    e.tick(1000);
    expect(e.ops.length).toBe(0);
    e.onStroke(id(1), stroke('s', [300, 300, 400, 300]), 1010);
    expect(e.ops.length).toBe(1); // a fresh op for the new round
  });

  it('records nothing and picks no winner for an empty round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.winnerPid).toBeNull();
    expect(over.history.length).toBe(0);
  });

  it('starts a wiped new round even if the boundary was missed entirely', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100]), 100);
    e.flush();
    const late = new GameEngine(cfg, store, 5000);
    expect(late.ops.length).toBe(0);
    expect(late.history.length).toBe(1);
  });

  it('nextEventAt points at the next phase change', () => {
    const e = mk();
    expect(e.nextEventAt(100)).toBe(900);
    expect(e.nextEventAt(950)).toBe(1000);
  });
});

describe('persistence', () => {
  it('restores players, wins, ops and ownership after a restart', () => {
    const store = new MemoryStore();
    const a = mk(0, store);
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    a.flush();

    const b = new GameEngine(cfg, store, 200);
    expect(b.players.get(id(1))!.name).toBe('Ann');
    expect(b.ops).toEqual(a.ops);
    expect(b.grid.shares()).toEqual(a.grid.shares());
    const welcome = of(b.join(id(1), 'Ann', undefined, 210), 'welcome')[0]!.msg;
    expect(welcome.ops.length).toBe(1);
  });

  it('does not write when nothing changed', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.flush();
    const before = store.writes;
    e.flush();
    expect(store.writes).toBe(before);
  });

  it('serves ops for past rounds', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    e.tick(950);
    e.tick(1000);
    expect(e.roundOps(0).length).toBe(1);
    expect(e.roundOps(12345)).toEqual([]);
  });
});

const fakeDef = (id: string, brush = 6) => ({ ...MODE_DEFS.paint, id: id as ModeId, name: id, brush });
const fakeCfg = (reg: Record<string, ModeEntry>, order: string[]) => ({
  roundMs: 1000, overMs: 100, order: order as ModeId[], password: '', registry: reg,
});
const shareOf = (e: GameEngine) => Object.values(e.grid.shares())[0] ?? 0;

describe('per-mode brush', () => {
  it('splat paints more ground than paint war for the same stroke', () => {
    const a = mk(0); // idx 0 = paint
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 400, 100]), 100);
    const b = new GameEngine({ ...cfg, order: ['splat', 'paint'] as ModeId[] }, new MemoryStore(), 0);
    b.join(id(1), 'Ann', undefined, 0);
    b.onStroke(id(1), stroke('s', [100, 100, 400, 100]), 100);
    expect(shareOf(b)).toBeGreaterThan(shareOf(a) * 2);
  });

  it('rebuilds the grid with the mode brush after a restart', () => {
    const store = new MemoryStore();
    const order = ['splat', 'paint'] as ModeId[];
    const a = new GameEngine({ ...cfg, order }, store, 0);
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 400, 100], true), 100);
    a.flush();
    const b = new GameEngine({ ...cfg, order }, store, 200);
    expect(b.grid.shares()).toEqual(a.grid.shares());
  });

  it('reports brush, how-to and the next mode in round info', () => {
    const e = mk(0);
    const w = of(e.join(id(1), 'Ann', undefined, 0), 'welcome')[0]!.msg;
    expect(w.round.brush).toBe(6);
    expect(w.round.howTo.length).toBeGreaterThan(0);
    expect(w.round.next.mode).toBe('enclose');
  });
});

describe('framework hooks (fake modes)', () => {
  const base: ModeEntry = { def: fakeDef('base'), rules: { id: 'paint', name: 'base', rules: 'r', onPoints: () => [] } };

  it('an erasing mode stores pid 0, clears earlier ownership, and a restart rebuilds the same grid', () => {
    let erase = false;
    const rules = { ...base.rules, get erases() { return erase; } };
    const reg = { base: { def: fakeDef('base'), rules } };
    const store = new MemoryStore();
    const e = new GameEngine(fakeCfg(reg, ['base']), store, 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('a', [100, 100, 400, 100], true), 100);
    expect(shareOf(e)).toBeGreaterThan(0);
    erase = true;
    e.onStroke(id(1), stroke('b', [100, 100, 400, 100], true), 200);
    const eraseOp = e.ops[1]!;
    expect(eraseOp.k === 's' ? eraseOp.pid : -1).toBe(0);
    expect(e.grid.shares()).toEqual({});
    e.flush();
    const r = new GameEngine(fakeCfg(reg, ['base']), store, 250);
    expect(r.grid.shares()).toEqual({});
  });

  it('a filtering mode drops points and splits the stroke without connecting the gap', () => {
    const rules = {
      ...base.rules,
      filterPoints: ({ pts }: { pts: Pt[] }) => {
        const runs: Pt[][] = [];
        let cur: Pt[] = [];
        for (const p of pts) {
          if (p.x >= 300 && p.x <= 500) { if (cur.length) { runs.push(cur); cur = []; } } else cur.push(p);
        }
        if (cur.length) runs.push(cur);
        return runs;
      },
    };
    const reg = { base: { def: fakeDef('base'), rules } };
    const e = new GameEngine(fakeCfg(reg, ['base']), new MemoryStore(), 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 200, 100, 400, 100, 600, 100, 700, 100]), 100);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(2);
    // the gap around x=400 must not be painted
    const midCell = Math.floor(400 / 4) + Math.floor(100 / 4) * 400;
    expect(e.grid.cells[midCell]).toBe(0);
    // the previous batch ended on an allowed point, so the same stroke simply continues
    e.onStroke(id(1), stroke('s', [700, 150, 710, 150]), 150);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(2);
    // a batch that ends inside the blocked zone (its first point still continues the stroke)...
    e.onStroke(id(1), stroke('s', [710, 200, 400, 200]), 200);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(2);
    // ...breaks it, so the next batch with the same client id starts a fresh op (no line across the gap)
    e.onStroke(id(1), stroke('s', [650, 250, 660, 250]), 250);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(3);
  });

  it('a scoring mode changes scores and picks the winner', () => {
    const rules = {
      ...base.rules,
      score: ({ players }: { players: { slot: number }[] }) => ({ [players[players.length - 1]!.slot]: 1 }),
    };
    const reg = { base: { def: fakeDef('base'), rules } };
    const e = new GameEngine(fakeCfg(reg, ['base']), new MemoryStore(), 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    const scores = of(e.tick(150), 'scores')[0]!.msg.shares;
    expect(scores[e.players.get(id(2))!.slot]).toBe(1);
    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.winnerPid).toBe(e.players.get(id(2))!.slot);
  });

  it('mode state is delivered to late joiners, emitted once per change, and survives a restart', () => {
    const rules = { ...base.rules, init: () => ({ flag: [1, 2] }) };
    const reg = { base: { def: fakeDef('base'), rules } };
    const store = new MemoryStore();
    const e = new GameEngine(fakeCfg(reg, ['base']), store, 0);
    e.join(id(1), 'Ann', undefined, 0);
    expect(of(e.tick(10), 'mode-state').length).toBe(1);
    expect(of(e.tick(20), 'mode-state').length).toBe(0);
    e.setModeState({ flag: [9, 9] });
    const out = e.tick(30);
    expect(of(out, 'mode-state').length).toBe(1);
    expect(of(out, 'mode-state')[0]!.msg.state).toEqual({ flag: [9, 9] });
    const late = of(e.join(id(2), 'Bob', undefined, 40), 'welcome')[0]!.msg;
    expect(late.modeState).toEqual({ flag: [9, 9] });
    e.flush();
    const r = new GameEngine(fakeCfg(reg, ['base']), store, 50);
    expect(r.modeState).toEqual({ flag: [9, 9] });
  });
});
