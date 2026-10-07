import { describe, it, expect } from 'vitest';
import { chunkPoints, inkColor, PAPER } from './render';

describe('chunkPoints', () => {
  it('splits a flat point array into pairs-aligned chunks, never repeating points', () => {
    const flat = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const chunks = chunkPoints(flat, 2); // max 2 points per chunk
    expect(chunks.every((c) => c.length % 2 === 0)).toBe(true);
    expect(chunks.every((c) => c.length / 2 <= 2)).toBe(true);
    expect(chunks.flat()).toEqual(flat);
    expect(chunks[0]).toEqual([0, 0, 1, 1]);
  });
  it('returns one chunk when under the limit', () => {
    expect(chunkPoints([1, 2, 3, 4], 64)).toEqual([[1, 2, 3, 4]]);
  });
  it('returns nothing for empty input', () => {
    expect(chunkPoints([], 64)).toEqual([]);
  });
});

describe('inkColor', () => {
  it('draws erasing strokes (pid 0) in paper color', () => {
    expect(inkColor(0, new Map([[1, '#f00']]))).toBe(PAPER);
  });
  it('uses the player color, with a gray fallback for unknown players', () => {
    const colors = new Map([[1, '#f00']]);
    expect(inkColor(1, colors)).toBe('#f00');
    expect(inkColor(9, colors)).toBe('#888888');
  });
});

import { opRadius } from './render';

describe('opRadius', () => {
  it('uses the erase brush for pid 0 strokes and the paint brush otherwise', () => {
    const r = opRadius({ brush: 6, eraseBrush: 20 });
    expect(r({ k: 's', id: 'a', pid: 0, pts: [] })).toBe(20);
    expect(r({ k: 's', id: 'a', pid: 3, pts: [] })).toBe(6);
    expect(r({ k: 'f', pid: 3, poly: [] })).toBe(6);
  });

  it('falls back to the paint brush when the mode has no eraser', () => {
    expect(opRadius({ brush: 6 })({ k: 's', id: 'a', pid: 0, pts: [] })).toBe(6);
  });
});
