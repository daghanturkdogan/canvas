import { polygonArea, segIntersect, type Pt } from './geometry';

const MIN_LOOP_AREA = 1;
const MAX_TRAIL = 3000;
const KEEP_AFTER_TRIM = 1500;

/**
 * A player's trail of points for the current round. Strokes are concatenated;
 * `breaks` holds indices of points that start a new stroke, so the straight
 * "bridge" between two strokes is never treated as a drawn line.
 */
export class LoopTrail {
  private pts: Pt[] = [];
  private breaks = new Set<number>();

  beginStroke(p: Pt): void {
    if (this.pts.length > 0) this.breaks.add(this.pts.length);
    this.pts.push(p);
  }

  /** Append a point. Returns the closed polygon if the new segment crosses an earlier drawn segment. */
  push(p: Pt): Pt[] | null {
    const n = this.pts.length;
    if (n === 0) {
      this.pts.push(p);
      return null;
    }
    const a = this.pts[n - 1]!;
    // newest-first so the smallest loop wins; skip adjacent segment (n-2) and bridges
    for (let i = n - 3; i >= 0; i--) {
      if (this.breaks.has(i + 1)) continue;
      const x = segIntersect(a, p, this.pts[i]!, this.pts[i + 1]!);
      if (x) {
        const poly = [x, ...this.pts.slice(i + 1)];
        // A new stroke that merely touches the end of an earlier one yields a zero-area "loop";
        // ignore it and keep looking for a real crossing further back.
        if (poly.length < 3 || polygonArea(poly) < MIN_LOOP_AREA) continue;
        this.pts = [x, p];
        this.breaks = new Set();
        return poly;
      }
    }
    this.pts.push(p);
    if (this.pts.length > MAX_TRAIL) this.trim();
    return null;
  }

  size(): number {
    return this.pts.length;
  }

  reset(): void {
    this.pts = [];
    this.breaks = new Set();
  }

  private trim(): void {
    const drop = this.pts.length - KEEP_AFTER_TRIM;
    this.pts = this.pts.slice(drop);
    const next = new Set<number>();
    for (const b of this.breaks) if (b - drop > 0) next.add(b - drop);
    this.breaks = next;
  }
}
