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
