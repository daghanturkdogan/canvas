import { describe, it, expect } from 'vitest';
import { segIntersect, polygonArea, pointInPolygon, decimate } from './geometry';

const P = (x: number, y: number) => ({ x, y });

describe('segIntersect', () => {
  it('finds a crossing point', () => {
    const p = segIntersect(P(0, 0), P(10, 10), P(0, 10), P(10, 0));
    expect(p!.x).toBeCloseTo(5);
    expect(p!.y).toBeCloseTo(5);
  });
  it('returns null for parallel segments', () => {
    expect(segIntersect(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBeNull();
  });
  it('returns null when segments do not reach each other', () => {
    expect(segIntersect(P(0, 0), P(1, 1), P(5, 0), P(5, 10))).toBeNull();
  });
});

describe('polygonArea / pointInPolygon', () => {
  const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  it('computes area', () => expect(polygonArea(square)).toBeCloseTo(100));
  it('detects inside and outside', () => {
    expect(pointInPolygon(P(5, 5), square)).toBe(true);
    expect(pointInPolygon(P(15, 5), square)).toBe(false);
  });
});

describe('decimate', () => {
  it('keeps short polygons unchanged', () => {
    const poly = [P(0, 0), P(1, 1), P(2, 2)];
    expect(decimate(poly, 10)).toEqual(poly);
  });
  it('reduces to at most max points', () => {
    const poly = Array.from({ length: 1000 }, (_, i) => P(i, i));
    expect(decimate(poly, 200).length).toBeLessThanOrEqual(200);
  });
});
