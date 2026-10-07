import { useEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W, MODE_DEFS, type Op, type RoundSummary } from '@gallery/shared';
import { clearCanvas, drawOps, PAPER } from '../canvas/render';

const SHOWN = 6;

function paint(canvas: HTMLCanvasElement, ops: Op[], round: RoundSummary, scale: number) {
  const ctx = canvas.getContext('2d')!;
  clearCanvas(ctx);
  drawOps(ctx, ops, (pid) => (pid === 0 ? PAPER : round.players[pid]?.color ?? '#888888'), scale, MODE_DEFS[round.mode].brush);
}

function caption(r: RoundSummary): string {
  const w = r.winnerPid !== null ? r.players[r.winnerPid] : undefined;
  const time = new Date(r.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${MODE_DEFS[r.mode]?.name ?? r.mode} · ${w ? `${w.name} won` : 'no winner'} · ${time}`;
}

function Thumb({ round, getRoundOps, onOpen }: { round: RoundSummary; getRoundOps: (i: number) => Promise<Op[]>; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    getRoundOps(round.idx).then((ops) => { if (live && ref.current) paint(ref.current, ops, round, 400 / CANVAS_W); });
    return () => { live = false; };
  }, [round, getRoundOps]);
  return (
    <div>
      <button className="mini-frame" onClick={onOpen} aria-label={caption(round)}>
        <canvas ref={ref} width={400} height={250} />
      </button>
      <div className="mini-label">{caption(round)}</div>
    </div>
  );
}

function Lightbox({ round, getRoundOps, onClose }: { round: RoundSummary; getRoundOps: (i: number) => Promise<Op[]>; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    getRoundOps(round.idx).then((ops) => { if (live && ref.current) paint(ref.current, ops, round, 1); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [round, getRoundOps, onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} />
        <div className="lightbox-caption">{caption(round)}</div>
      </div>
    </div>
  );
}

export function PastRounds({ history, getRoundOps }: { history: RoundSummary[]; getRoundOps: (idx: number) => Promise<Op[]> }) {
  const [open, setOpen] = useState<RoundSummary | null>(null);
  const recent = history.slice(-SHOWN).reverse();
  return (
    <aside className="past">
      <h2>Past Rounds</h2>
      {recent.length === 0 && <div className="mini-label">The wall is empty — for now.</div>}
      {recent.map((r) => (
        <Thumb key={r.idx} round={r} getRoundOps={getRoundOps} onOpen={() => setOpen(r)} />
      ))}
      {open && <Lightbox round={open} getRoundOps={getRoundOps} onClose={() => setOpen(null)} />}
    </aside>
  );
}
