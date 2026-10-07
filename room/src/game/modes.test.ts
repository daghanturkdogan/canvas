import { describe, it, expect } from 'vitest';
import { MODES, type ModeApi } from './modes';
import { LoopTrail } from './loops';
import type { PlayerState } from './types';
import type { Pt } from './geometry';

const P = (x: number, y: number) => ({ x, y });
const player = (): PlayerState => ({
  clientId: 'c', slot: 1, name: 'A', color: '#fff', online: true, lastSeen: 0, wins: 0,
  stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null, lastMsgAt: 0, tokens: 40, tokensAt: 0,
});
const api: ModeApi = { state: null, setState: () => {} };
const run = (mode: 'paint' | 'enclose', p: PlayerState, pts: Pt[], newStroke: boolean) =>
  MODES[mode].onPoints({ player: p, pts, newStroke, now: 0, round: { idx: 0, startsAt: 0, overAt: 1000 }, api });

describe('modes', () => {
  it('paint never produces fills', () => {
    expect(run('paint', player(), [P(0, 0), P(5, 5)], true)).toEqual([]);
  });

  it('enclose emits a polygon when the stroke loops', () => {
    const polys = run('enclose', player(), [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)], true);
    expect(polys.length).toBe(1);
  });

  it('enclose keeps the trail across batches of one stroke', () => {
    const p = player();
    run('enclose', p, [P(0, 0), P(100, 0)], true);
    run('enclose', p, [P(100, 100), P(0, 100)], false);
    const polys = run('enclose', p, [P(50, -50)], false);
    expect(polys.length).toBe(1);
  });

  it('each mode has a name and rules text', () => {
    for (const m of Object.values(MODES)) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.rules.length).toBeGreaterThan(0);
    }
  });
});
