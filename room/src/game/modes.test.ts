import { describe, it, expect } from 'vitest';
import { MODES } from './modes';
import { LoopTrail } from './loops';
import type { PlayerState } from './types';

const P = (x: number, y: number) => ({ x, y });
const player = (): PlayerState => ({
  clientId: 'c', slot: 1, name: 'A', color: '#fff', online: true, lastSeen: 0, wins: 0,
  stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null, lastMsgAt: 0, tokens: 40, tokensAt: 0,
});

describe('modes', () => {
  it('paint never produces fills', () => {
    expect(MODES.paint.onPoints({ player: player(), pts: [P(0, 0), P(5, 5)], newStroke: true })).toEqual([]);
  });

  it('enclose emits a polygon when the stroke loops', () => {
    const p = player();
    const polys = MODES.enclose.onPoints({
      player: p,
      pts: [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)],
      newStroke: true,
    });
    expect(polys.length).toBe(1);
  });

  it('enclose keeps the trail across batches of one stroke', () => {
    const p = player();
    MODES.enclose.onPoints({ player: p, pts: [P(0, 0), P(100, 0)], newStroke: true });
    MODES.enclose.onPoints({ player: p, pts: [P(100, 100), P(0, 100)], newStroke: false });
    const polys = MODES.enclose.onPoints({ player: p, pts: [P(50, -50)], newStroke: false });
    expect(polys.length).toBe(1);
  });

  it('each mode has a name and rules text', () => {
    for (const m of Object.values(MODES)) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.rules.length).toBeGreaterThan(0);
    }
  });
});
