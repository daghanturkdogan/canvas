import { useEffect, useRef, type MutableRefObject } from 'react';
import { CANVAS_H, CANVAS_W, type PlayerInfo } from '@gallery/shared';
import type { CursorMap } from './PaintCanvas';

const VISIBLE_MS = 2000;

interface Props { cursors: MutableRefObject<CursorMap>; players: PlayerInfo[]; you: number | null }

export function CursorLayer({ cursors, players, you }: Props) {
  const els = useRef(new Map<number, HTMLDivElement>());
  const smooth = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      for (const [pid, el] of els.current) {
        const c = cursors.current.get(pid);
        if (!c || now - c.at > VISIBLE_MS) { el.style.opacity = '0'; smooth.current.delete(pid); continue; }
        const s = smooth.current.get(pid) ?? { x: c.x, y: c.y };
        s.x += (c.x - s.x) * 0.35;
        s.y += (c.y - s.y) * 0.35;
        smooth.current.set(pid, s);
        el.style.opacity = '1';
        el.style.transform = `translate(${(s.x / CANVAS_W) * 100}cqw, ${(s.y / CANVAS_H) * 100}cqh)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cursors]);

  return (
    <div className="cursor-layer">
      {players.filter((p) => p.online && p.pid !== you).map((p) => (
        <div
          key={p.pid}
          className="cursor"
          ref={(el) => { if (el) els.current.set(p.pid, el); else els.current.delete(p.pid); }}
          style={{ ['--c' as string]: p.color }}
        >
          <span className="cursor-dot" />
          <span className="cursor-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}
