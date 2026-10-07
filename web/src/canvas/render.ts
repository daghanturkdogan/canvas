import { BRUSH_RADIUS, CANVAS_H, CANVAS_W, type Op } from '@gallery/shared';

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#f7f1e3';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawSegment(
  ctx: CanvasRenderingContext2D, color: string, pts: number[], prev: { x: number; y: number } | null, scale = 1,
): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = BRUSH_RADIUS * 2 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!prev && pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0]! * scale, pts[1]! * scale, BRUSH_RADIUS * scale, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (prev) ctx.moveTo(prev.x * scale, prev.y * scale);
  else ctx.moveTo(pts[0]! * scale, pts[1]! * scale);
  for (let i = prev ? 0 : 2; i < pts.length; i += 2) ctx.lineTo(pts[i]! * scale, pts[i + 1]! * scale);
  ctx.stroke();
}

export function drawFill(ctx: CanvasRenderingContext2D, color: string, poly: number[], scale = 1): void {
  if (poly.length < 6) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0]! * scale, poly[1]! * scale);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i]! * scale, poly[i + 1]! * scale);
  ctx.closePath();
  ctx.fill();
}

export function drawOps(
  ctx: CanvasRenderingContext2D, ops: Op[], colorOf: (pid: number) => string, scale = 1,
): void {
  for (const op of ops) {
    if (op.k === 's') drawSegment(ctx, colorOf(op.pid), op.pts, null, scale);
    else drawFill(ctx, colorOf(op.pid), op.poly, scale);
  }
}

/** Split a flat [x,y,...] array into chunks of at most `max` points, without repeating points. */
export function chunkPoints(flat: number[], max: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += max * 2) out.push(flat.slice(i, i + max * 2));
  return out;
}

export const CANVAS_SIZE = { w: CANVAS_W, h: CANVAS_H };
