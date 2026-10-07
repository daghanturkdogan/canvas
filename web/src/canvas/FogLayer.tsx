import { useEffect, useRef } from 'react';
import { CANVAS_H, CANVAS_W, type PlayerInfo } from '@gallery/shared';
import type { OpLog } from './opLog';
import { drawOps } from './render';

const LANTERN = 150;
const FOG = '#d6caae';

interface Props {
  /** Fog is on (Fog of War, while drawing is open). */
  active: boolean;
  you: number | null;
  players: PlayerInfo[];
  opLog: OpLog;
  brush: number;
}

/** Hides everyone else's ink: you see your own strokes and a lantern circle around your cursor. */
export function FogLayer({ active, you, players, opLog, brush }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(true);
  const seen = useRef(-1);
  const playersRef = useRef(players);
  playersRef.current = players;

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const c = ref.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      cursor.current = inside
        ? { x: ((e.clientX - r.left) / r.width) * CANVAS_W, y: ((e.clientY - r.top) / r.height) * CANVAS_H }
        : null;
      dirty.current = true;
    };
    window.addEventListener('pointermove', onMove);

    const paint = () => {
      const c = ref.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = FOG;
      g.fillRect(0, 0, c.width, c.height);
      if (cursor.current) {
        const { x, y } = cursor.current;
        const grad = g.createRadialGradient(x, y, 0, x, y, LANTERN);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.7, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, LANTERN, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'source-over';
      }
      if (you !== null) {
        const colors = new Map(playersRef.current.map((p) => [p.pid, p.color]));
        const mine = opLog.snapshot().filter((op) => op.pid === you);
        drawOps(g, mine, (pid) => colors.get(pid) ?? '#888888', 1, brush);
      }
    };

    let raf = 0;
    const loop = () => {
      if (opLog.version !== seen.current) {
        seen.current = opLog.version;
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [active, you, opLog, brush]);

  if (!active) return null;
  return <canvas ref={ref} className="fog-layer" width={CANVAS_W} height={CANVAS_H} />;
}
