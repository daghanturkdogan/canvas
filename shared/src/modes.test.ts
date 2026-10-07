import { describe, it, expect } from 'vitest';
import { MODE_DEFS, overlayShapes, nextModeInfo } from './modes';
import { MODE_ORDER } from './constants';
import type { ModeDef } from './modes';

describe('MODE_DEFS', () => {
  it('has a complete definition for every mode in the rotation', () => {
    for (const id of MODE_ORDER) {
      const d = MODE_DEFS[id];
      expect(d.id).toBe(id);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.rules.length).toBeGreaterThan(0);
      expect(d.howTo.length).toBeGreaterThanOrEqual(3);
      expect(d.brush).toBeGreaterThan(0);
    }
  });

  it('gives Splat a much bigger brush than Paint War', () => {
    expect(MODE_DEFS.splat.brush).toBeGreaterThanOrEqual(MODE_DEFS.paint.brush * 3);
  });
});

describe('nextModeInfo', () => {
  it('describes the following mode', () => {
    const n = nextModeInfo(0, MODE_ORDER);
    expect(n.mode).toBe(MODE_ORDER[1]);
    expect(n.howTo.length).toBeGreaterThan(0);
  });

  it('wraps around after the last mode', () => {
    const n = nextModeInfo(MODE_ORDER.length - 1, MODE_ORDER);
    expect(n.mode).toBe(MODE_ORDER[0]);
  });
});

describe('overlayShapes', () => {
  const round = { idx: 4, startsAt: 0, overAt: 50_000 };
  it('returns nothing for modes without an overlay', () => {
    for (const id of MODE_ORDER) expect(overlayShapes(MODE_DEFS[id], round, 1000, null)).toEqual([]);
  });

  it('delegates to a definition that has an overlay function', () => {
    const def: ModeDef = {
      ...MODE_DEFS.paint,
      overlay: (_r, _now, state) => [{ kind: 'circle', x: Number((state as { x: number }).x), y: 5, r: 10, tone: 'zone' }],
    };
    expect(overlayShapes(def, round, 0, { x: 3 })).toEqual([{ kind: 'circle', x: 3, y: 5, r: 10, tone: 'zone' }]);
  });
});
