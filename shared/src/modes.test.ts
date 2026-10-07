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

  it('marks fog and gives the eraser mode a wider erase brush', () => {
    expect(MODE_DEFS.fog.fog).toBe(true);
    expect(MODE_DEFS.eraser.eraseBrush).toBeGreaterThan(MODE_DEFS.eraser.brush);
  });

  it('scores four modes in points and every other mode in territory percent', () => {
    const points = ['hotzones', 'hill', 'ctf', 'shrink'];
    for (const id of MODE_ORDER) {
      expect(MODE_DEFS[id].scoreUnit ?? 'percent').toBe(points.includes(id) ? 'points' : 'percent');
    }
  });

  it('spells the point rules out in the how-to lines', () => {
    expect(MODE_DEFS.hotzones.howTo.join(' ')).toMatch(/5 points/);
    expect(MODE_DEFS.hill.howTo.join(' ')).toMatch(/points/);
    expect(MODE_DEFS.ctf.howTo.join(' ')).toMatch(/100 points/);
    expect(MODE_DEFS.shrink.howTo.join(' ')).toMatch(/points/);
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
    for (const id of ['paint', 'splat', 'enclose', 'fog', 'eraser', 'teams'] as const) {
      expect(overlayShapes(MODE_DEFS[id], round, 1000, null)).toEqual([]);
    }
  });

  it('gives the zone modes real overlays', () => {
    expect(overlayShapes(MODE_DEFS.hotzones, round, 1000, null).length).toBe(3);
    expect(overlayShapes(MODE_DEFS.shrink, round, 1000, null)[0]!.kind).toBe('ring');
    expect(overlayShapes(MODE_DEFS.hill, round, 1000, null).length).toBe(1);
    expect(overlayShapes(MODE_DEFS.ctf, round, 1000, { n: 0 }).length).toBe(1);
  });

  it('moves the flag after a capture', () => {
    const a = overlayShapes(MODE_DEFS.ctf, round, 1000, { n: 0 });
    const b = overlayShapes(MODE_DEFS.ctf, round, 1000, { n: 1 });
    expect(a).not.toEqual(b);
  });

  it('delegates to a definition that has an overlay function', () => {
    const def: ModeDef = {
      ...MODE_DEFS.paint,
      overlay: (_r, _now, state) => [{ kind: 'circle', x: Number((state as { x: number }).x), y: 5, r: 10, tone: 'zone' }],
    };
    expect(overlayShapes(def, round, 0, { x: 3 })).toEqual([{ kind: 'circle', x: 3, y: 5, r: 10, tone: 'zone' }]);
  });
});
