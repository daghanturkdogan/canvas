import { CELL, GRID_H, GRID_W } from '@gallery/shared';
import { pointInPolygon, type Pt } from './geometry';

export class OwnershipGrid {
  readonly cells = new Uint8Array(GRID_W * GRID_H);

  /** Stamp a round brush along a polyline. Returns cells taken from other owners. */
  stampPath(owner: number, pts: Pt[], r: number): number {
    let stolen = 0;
    if (pts.length === 0) return 0;
    stolen += this.stampCircle(owner, pts[0]!.x, pts[0]!.y, r);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / CELL));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        stolen += this.stampCircle(owner, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r);
      }
    }
    return stolen;
  }

  private stampCircle(owner: number, cx: number, cy: number, r: number): number {
    let stolen = 0;
    const gx0 = Math.max(0, Math.floor((cx - r) / CELL));
    const gx1 = Math.min(GRID_W - 1, Math.floor((cx + r) / CELL));
    const gy0 = Math.max(0, Math.floor((cy - r) / CELL));
    const gy1 = Math.min(GRID_H - 1, Math.floor((cy + r) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
        if (Math.hypot(px - cx, py - cy) > r) continue;
        const i = gy * GRID_W + gx;
        const prev = this.cells[i]!;
        if (prev !== 0 && prev !== owner) stolen++;
        this.cells[i] = owner;
      }
    }
    return stolen;
  }

  /** Indices of cells whose centers lie inside the polygon. */
  polygonCells(poly: Pt[]): number[] {
    if (poly.length < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const gx0 = Math.max(0, Math.floor(minX / CELL)), gx1 = Math.min(GRID_W - 1, Math.floor(maxX / CELL));
    const gy0 = Math.max(0, Math.floor(minY / CELL)), gy1 = Math.min(GRID_H - 1, Math.floor(maxY / CELL));
    const out: number[] = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (pointInPolygon({ x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 }, poly)) out.push(gy * GRID_W + gx);
      }
    }
    return out;
  }

  setCells(owner: number, cells: number[]): number {
    let stolen = 0;
    for (const i of cells) {
      const prev = this.cells[i]!;
      if (prev !== 0 && prev !== owner) stolen++;
      this.cells[i] = owner;
    }
    return stolen;
  }

  /** Fraction of the whole canvas owned by each owner (owners with 0 cells omitted). */
  shares(): Record<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < this.cells.length; i++) {
      const o = this.cells[i]!;
      if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const out: Record<number, number> = {};
    for (const [o, n] of counts) out[o] = n / this.cells.length;
    return out;
  }

  clear(): void {
    this.cells.fill(0);
  }
}
