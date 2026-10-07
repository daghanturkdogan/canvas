import { describe, it, expect } from 'vitest';
import { OwnershipGrid } from './ownership';
import { GRID_W, GRID_H } from '@gallery/shared';

const P = (x: number, y: number) => ({ x, y });
const idx = (gx: number, gy: number) => gy * GRID_W + gx;

describe('OwnershipGrid', () => {
  it('stamps a dot for a single point', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    expect(g.cells[idx(25, 25)]).toBe(1);
    expect(g.cells[idx(60, 60)]).toBe(0);
  });

  it('stamps along a path with no gaps', () => {
    const g = new OwnershipGrid();
    g.stampPath(2, [P(10, 100), P(400, 100)], 6);
    for (let gx = 3; gx < 98; gx++) expect(g.cells[idx(gx, 25)]).toBe(2);
  });

  it('counts stolen cells when painting over another owner', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    const stolen = g.stampPath(2, [P(100, 100)], 6);
    expect(stolen).toBeGreaterThan(0);
    expect(g.cells[idx(25, 25)]).toBe(2);
  });

  it('does not count repainting your own cells as stolen', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    expect(g.stampPath(1, [P(100, 100)], 6)).toBe(0);
  });

  it('computes polygon cells by cell centers', () => {
    const g = new OwnershipGrid();
    const cells = g.polygonCells([P(0, 0), P(40, 0), P(40, 40), P(0, 40)]);
    expect(cells.length).toBe(100);
  });

  it('setCells assigns ownership and reports stolen', () => {
    const g = new OwnershipGrid();
    g.setCells(1, [idx(0, 0), idx(1, 0)]);
    const stolen = g.setCells(2, [idx(1, 0), idx(2, 0)]);
    expect(stolen).toBe(1);
    expect(g.cells[idx(1, 0)]).toBe(2);
  });

  it('computes shares of the whole canvas and clears', () => {
    const g = new OwnershipGrid();
    const total = GRID_W * GRID_H;
    g.setCells(3, Array.from({ length: total / 4 }, (_, i) => i));
    expect(g.shares()[3]).toBeCloseTo(0.25);
    g.clear();
    expect(g.shares()).toEqual({});
  });
});
