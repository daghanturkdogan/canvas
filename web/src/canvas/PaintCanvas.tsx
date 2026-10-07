import { useEffect, useRef, type MutableRefObject } from 'react';
import { CANVAS_H, CANVAS_W, MAX_PTS_PER_MSG, type ClientMsg, type PlayerInfo, type ServerMsg } from '@gallery/shared';
import { chunkPoints, clearCanvas, drawFill, drawOps, drawSegment } from './render';

export type CursorMap = Map<number, { x: number; y: number; at: number }>;

interface Props {
  send: (m: ClientMsg) => void;
  subscribe: (fn: (m: ServerMsg) => void) => () => void;
  players: PlayerInfo[];
  you: number | null;
  enabled: boolean;
  cursors: MutableRefObject<CursorMap>;
}

const FLUSH_MS = 66;

export function PaintCanvas({ send, subscribe, players, you, enabled, cursors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useRef(new Map<number, string>());
  const lastPt = useRef(new Map<string, { x: number; y: number }>());
  const draw = useRef<{ id: string; buf: number[]; timer: ReturnType<typeof setInterval> } | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const youRef = useRef(you);
  youRef.current = you;

  useEffect(() => {
    colors.current = new Map(players.map((p) => [p.pid, p.color]));
  }, [players]);

  const colorOf = (pid: number) => colors.current.get(pid) ?? '#888888';
  const ctx = () => canvasRef.current!.getContext('2d')!;

  useEffect(() => {
    clearCanvas(ctx());
    return subscribe((m) => {
      const c = ctx();
      if (m.t === 'welcome') {
        colors.current = new Map(m.players.map((p) => [p.pid, p.color]));
        lastPt.current.clear();
        clearCanvas(c);
        drawOps(c, m.ops, colorOf);
      } else if (m.t === 'round' && m.wipe) {
        lastPt.current.clear();
        clearCanvas(c);
        cursors.current.clear();
      } else if (m.t === 'stroke') {
        const key = `${m.pid}:${m.id}`;
        drawSegment(c, colorOf(m.pid), m.pts, lastPt.current.get(key) ?? null);
        lastPt.current.set(key, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]! });
        cursors.current.set(m.pid, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]!, at: performance.now() });
      } else if (m.t === 'fill') {
        drawFill(c, colorOf(m.pid), m.poly);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * CANVAS_W),
      y: Math.round(((e.clientY - r.top) / r.height) * CANVAS_H),
    };
  };

  const flush = (end: boolean) => {
    const d = draw.current;
    if (!d) return;
    const chunks = chunkPoints(d.buf, MAX_PTS_PER_MSG);
    d.buf = [];
    if (chunks.length === 0) return;
    chunks.forEach((pts, i) => send({ t: 'stroke', id: d.id, pts, end: end && i === chunks.length - 1 }));
  };

  const onDown = (e: React.PointerEvent) => {
    if (!enabledRef.current || youRef.current === null || draw.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = Math.random().toString(36).slice(2, 10);
    const p = toCanvas(e);
    drawSegment(ctx(), colorOf(youRef.current), [p.x, p.y], null);
    lastPt.current.set(`${youRef.current}:${id}`, p);
    draw.current = { id, buf: [p.x, p.y], timer: setInterval(() => flush(false), FLUSH_MS) };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = draw.current;
    if (!d) return;
    if (!enabledRef.current) return onUp();
    const p = toCanvas(e);
    const key = `${youRef.current}:${d.id}`;
    drawSegment(ctx(), colorOf(youRef.current!), [p.x, p.y], lastPt.current.get(key) ?? null);
    lastPt.current.set(key, p);
    d.buf.push(p.x, p.y);
  };

  function onUp() {
    const d = draw.current;
    if (!d) return;
    clearInterval(d.timer);
    flush(true);
    draw.current = null;
  }

  useEffect(() => () => { if (draw.current) clearInterval(draw.current.timer); }, []);

  return (
    <canvas
      ref={canvasRef}
      className="paint-canvas"
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ cursor: enabled ? 'crosshair' : 'not-allowed', touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
