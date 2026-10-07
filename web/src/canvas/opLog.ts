import type { Op, ServerMsg, StrokeOp } from '@gallery/shared';

/**
 * The current round's drawing as the client knows it. It is fed by every server message
 * (whether or not the canvas is mounted), so a canvas that mounts after the welcome arrived,
 * or after a refresh/reconnect, can replay the existing drawing from `snapshot()`.
 */
export class OpLog {
  private ops: Op[] = [];
  private strokes = new Map<string, StrokeOp>();

  apply(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.ops = [];
        this.strokes.clear();
        for (const op of m.ops) {
          if (op.k === 's') this.addPoints(op.pid, op.id, op.pts);
          else this.ops.push({ k: 'f', pid: op.pid, poly: [...op.poly] });
        }
        break;
      case 'round':
        if (m.wipe) this.clear();
        break;
      case 'stroke':
        this.addPoints(m.pid, m.id, m.pts);
        break;
      case 'fill':
        this.ops.push({ k: 'f', pid: m.pid, poly: [...m.poly] });
        break;
      default:
        break;
    }
  }

  /** The local player's own points: the server never echoes a stroke back to its author. */
  addLocalPoints(pid: number, id: string, pts: number[]): void {
    this.addPoints(pid, id, pts);
  }

  snapshot(): Op[] {
    return this.ops;
  }

  private clear(): void {
    this.ops = [];
    this.strokes.clear();
  }

  private addPoints(pid: number, id: string, pts: number[]): void {
    const key = `${pid}:${id}`;
    const existing = this.strokes.get(key);
    if (existing) {
      existing.pts.push(...pts);
      return;
    }
    const op: StrokeOp = { k: 's', id, pid, pts: [...pts] };
    this.strokes.set(key, op);
    this.ops.push(op);
  }
}
