import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  CANVAS_H, CANVAS_W, MAX_PTS_PER_MSG, MODE_DEFS, type ClientMsg, type PlayerInfo, type ServerMsg,
} from '@gallery/shared';
import { PAPER, chunkPoints, clearCanvas, drawFill, drawOps, drawSegment, inkColor, opRadius } from './render';
import type { OpLog } from './opLog';

export type CursorMap = Map<number, { x: number; y: number; at: number }>;

interface Props {
  send: (m: ClientMsg) => void;
  subscribe: (fn: (m: ServerMsg) => void) => () => void;
  opLog: OpLog;
  players: PlayerInfo[];
  you: number | null;
  enabled: boolean;
  brush: number;
  /** Erase brush radius when the current mode lets players erase. */
  eraseBrush?: number;
  /** The on-screen Eraser toggle (Shift also erases). */
  erasing: boolean;
  /** Returns false for spots that cannot be painted right now (Shrinking Zone). */
  allow?: (x: number, y: number) => boolean;
  cursors: MutableRefObject<CursorMap>;
}

const FLUSH_MS = 100;

interface Pen { id: string; pid: number; erase: boolean; buf: number[]; timer: ReturnType<typeof setInterval> }

export function PaintCanvas({ send, subscribe, opLog, players, you, enabled, brush, eraseBrush, erasing, allow, cursors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useRef(new Map<number, string>());
  const lastPt = useRef(new Map<string, { x: number; y: number }>());
  const pen = useRef<Pen | null>(null);
  const pressed = useRef(false);
  const shift = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const youRef = useRef(you);
  youRef.current = you;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const eraseBrushRef = useRef(eraseBrush);
  eraseBrushRef.current = eraseBrush;
  const erasingRef = useRef(erasing);
  erasingRef.current = erasing;
  const allowRef = useRef(allow);
  allowRef.current = allow;

  useEffect(() => {
    colors.current = new Map(players.map((p) => [p.pid, p.color]));
  }, [players]);

  useEffect(() => {
    const track = (e: KeyboardEvent) => { shift.current = e.shiftKey; };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    return () => { window.removeEventListener('keydown', track); window.removeEventListener('keyup', track); };
  }, []);

  const colorOf = (pid: number) => inkColor(pid, colors.current);
  const radiusOf = (pid: number) => (pid === 0 ? eraseBrushRef.current ?? brushRef.current : brushRef.current);
  const ctx = () => canvasRef.current!.getContext('2d')!;

  useEffect(() => {
    // The welcome (with the existing drawing) usually arrives before this canvas mounts,
    // so replay what the log already holds, then stay subscribed for live updates.
    colors.current = new Map(players.map((p) => [p.pid, p.color]));
    clearCanvas(ctx());
    drawOps(ctx(), opLog.snapshot(), colorOf, 1, opRadius({ brush: brushRef.current, eraseBrush: eraseBrushRef.current }));
    return subscribe((m) => {
      const c = ctx();
      if (m.t === 'welcome') {
        colors.current = new Map(m.players.map((p) => [p.pid, p.color]));
        const def = MODE_DEFS[m.round.mode];
        brushRef.current = def.brush;
        eraseBrushRef.current = def.eraseBrush;
        lastPt.current.clear();
        clearCanvas(c);
        drawOps(c, m.ops, colorOf, 1, opRadius(def));
      } else if (m.t === 'players') {
        colors.current = new Map(m.players.map((p) => [p.pid, p.color]));
      } else if (m.t === 'round' && m.wipe) {
        lastPt.current.clear();
        clearCanvas(c);
        cursors.current.clear();
      } else if (m.t === 'stroke') {
        const key = `${m.pid}:${m.id}`;
        drawSegment(c, colorOf(m.pid), m.pts, lastPt.current.get(key) ?? null, 1, radiusOf(m.pid));
        lastPt.current.set(key, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]! });
        if (m.pid !== 0) cursors.current.set(m.pid, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]!, at: performance.now() });
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
    const d = pen.current;
    if (!d) return;
    const chunks = chunkPoints(d.buf, MAX_PTS_PER_MSG);
    d.buf = [];
    if (chunks.length === 0) return;
    chunks.forEach((pts, i) => {
      const msg: ClientMsg = { t: 'stroke', id: d.id, pts, end: end && i === chunks.length - 1 };
      if (d.erase) msg.erase = true;
      send(msg);
    });
  };

  const startStroke = (p: { x: number; y: number }) => {
    const me = youRef.current;
    if (me === null) return;
    const erase = eraseBrushRef.current !== undefined && (shift.current || erasingRef.current);
    const pid = erase ? 0 : me;
    const id = Math.random().toString(36).slice(2, 10);
    drawSegment(ctx(), erase ? PAPER : colorOf(me), [p.x, p.y], null, 1, radiusOf(pid));
    opLog.addLocalPoints(pid, id, [p.x, p.y]);
    lastPt.current.set(`${pid}:${id}`, p);
    pen.current = { id, pid, erase, buf: [p.x, p.y], timer: setInterval(() => flush(false), FLUSH_MS) };
  };

  const endStroke = () => {
    const d = pen.current;
    if (!d) return;
    clearInterval(d.timer);
    flush(true);
    pen.current = null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!enabledRef.current || youRef.current === null || pressed.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    const p = toCanvas(e);
    if (!allowRef.current || allowRef.current(p.x, p.y)) startStroke(p);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pressed.current) return;
    // A missed pointerup (released outside the window, capture lost) must not leave the pen down.
    if (!enabledRef.current || e.buttons === 0) return onUp();
    const p = toCanvas(e);
    if (allowRef.current && !allowRef.current(p.x, p.y)) {
      endStroke(); // left the allowed area: stop; drawing resumes (as a new stroke) when you come back
      return;
    }
    const d = pen.current;
    if (!d) {
      startStroke(p);
      return;
    }
    const key = `${d.pid}:${d.id}`;
    drawSegment(ctx(), d.erase ? PAPER : colorOf(youRef.current!), [p.x, p.y], lastPt.current.get(key) ?? null, 1, radiusOf(d.pid));
    lastPt.current.set(key, p);
    opLog.addLocalPoints(d.pid, d.id, [p.x, p.y]);
    d.buf.push(p.x, p.y);
  };

  function onUp() {
    pressed.current = false;
    endStroke();
  }

  useEffect(() => () => { if (pen.current) clearInterval(pen.current.timer); }, []);

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
      onLostPointerCapture={onUp}
    />
  );
}
