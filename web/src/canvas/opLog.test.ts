import { describe, it, expect } from 'vitest';
import { OpLog } from './opLog';
import type { Op, RoundInfo, ServerMsg } from '@gallery/shared';

const round: RoundInfo = {
  idx: 1, mode: 'paint', modeName: 'Paint War', rules: 'r', howTo: ['a'], brush: 6, phase: 'playing',
  startsAt: 0, overAt: 900, endsAt: 1000,
  next: { mode: 'splat', name: 'Splat', rules: 'r', howTo: ['b'], brush: 20 },
};
const welcome = (ops: Op[]): ServerMsg => ({
  t: 'welcome', serverNow: 0, you: 1, players: [], round, winnerPid: null, ops, shares: {}, history: [], modeState: null,
});

describe('OpLog', () => {
  it('holds the drawing from a welcome so a late-mounting canvas can replay it', () => {
    const log = new OpLog();
    log.apply(welcome([{ k: 's', id: 'a', pid: 2, pts: [1, 1, 5, 5] }, { k: 'f', pid: 2, poly: [0, 0, 10, 0, 10, 10] }]));
    expect(log.snapshot().length).toBe(2);
  });

  it('appends points to an existing stroke and starts new strokes', () => {
    const log = new OpLog();
    log.apply(welcome([]));
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [1, 1, 2, 2] });
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [3, 3] });
    log.apply({ t: 'stroke', id: 'a', pid: 3, pts: [9, 9] }); // same id, different player
    const ops = log.snapshot();
    expect(ops.length).toBe(2);
    expect(ops[0]).toEqual({ k: 's', id: 'a', pid: 2, pts: [1, 1, 2, 2, 3, 3] });
  });

  it('records fills in order with strokes', () => {
    const log = new OpLog();
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [1, 1] });
    log.apply({ t: 'fill', pid: 2, poly: [0, 0, 10, 0, 10, 10] });
    expect(log.snapshot().map((o) => o.k)).toEqual(['s', 'f']);
  });

  it('clears on a wiping round and keeps the drawing on a non-wiping one', () => {
    const log = new OpLog();
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [1, 1] });
    log.apply({ t: 'round', round, winnerPid: 2, wipe: false, history: [] });
    expect(log.snapshot().length).toBe(1);
    log.apply({ t: 'round', round, winnerPid: null, wipe: true, history: [] });
    expect(log.snapshot()).toEqual([]);
  });

  it('replaces its contents on every welcome (reconnect) instead of duplicating', () => {
    const log = new OpLog();
    const ops: Op[] = [{ k: 's', id: 'a', pid: 2, pts: [1, 1, 5, 5] }];
    log.apply(welcome(ops));
    log.apply(welcome(ops));
    expect(log.snapshot().length).toBe(1);
  });

  it('does not mutate the ops array carried by the message', () => {
    const log = new OpLog();
    const ops: Op[] = [{ k: 's', id: 'a', pid: 2, pts: [1, 1] }];
    log.apply(welcome(ops));
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [2, 2] });
    expect(ops[0]).toEqual({ k: 's', id: 'a', pid: 2, pts: [1, 1] });
  });

  it('records the local player\'s own points (the server never echoes them back)', () => {
    const log = new OpLog();
    log.addLocalPoints(4, 'mine', [10, 10]);
    log.addLocalPoints(4, 'mine', [20, 20]);
    expect(log.snapshot()).toEqual([{ k: 's', id: 'mine', pid: 4, pts: [10, 10, 20, 20] }]);
  });

  it('ignores messages that are not about the drawing', () => {
    const log = new OpLog();
    log.apply({ t: 'scores', shares: { 1: 0.5 } });
    log.apply({ t: 'players', players: [] });
    expect(log.snapshot()).toEqual([]);
  });

  it('keeps erase strokes (pid 0) like any other stroke', () => {
    const log = new OpLog();
    log.apply({ t: 'stroke', id: 'e', pid: 0, pts: [1, 1, 2, 2] });
    expect(log.snapshot()).toEqual([{ k: 's', id: 'e', pid: 0, pts: [1, 1, 2, 2] }]);
  });

  it('bumps its version whenever the drawing changes, so layers can redraw cheaply', () => {
    const log = new OpLog();
    const v0 = log.version;
    log.apply({ t: 'stroke', id: 'a', pid: 2, pts: [1, 1] });
    const v1 = log.version;
    log.addLocalPoints(1, 'mine', [5, 5]);
    const v2 = log.version;
    log.apply({ t: 'scores', shares: {} });
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
    expect(log.version).toBe(v2);
  });
});
