import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MODE_DEFS, inCircle, overlayShapes, ringAt, type ClientMsg, type Op, type ServerMsg,
} from '@gallery/shared';
import type { RoomState } from '../state/roomReducer';
import { PaintCanvas, type CursorMap } from '../canvas/PaintCanvas';
import { CursorLayer } from '../canvas/CursorLayer';
import { FogLayer } from '../canvas/FogLayer';
import { OverlayLayer } from '../canvas/OverlayLayer';
import type { OpLog } from '../canvas/opLog';
import { useNow } from '../useNow';
import { Plaque } from './Plaque';
import { Leaderboard } from './Leaderboard';
import { RoundOver } from './RoundOver';
import { PastRounds } from './PastRounds';

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  subscribe: (fn: (m: ServerMsg) => void) => () => void;
  getRoundOps: (idx: number) => Promise<Op[]>;
  opLog: OpLog;
  onTakeOver: () => void;
  onLeave: () => void;
  children?: ReactNode;
}

export function Gallery({ state, send, subscribe, getRoundOps, opLog, onTakeOver, onLeave }: Props) {
  const cursors = useRef<CursorMap>(new Map());
  const [erasing, setErasing] = useState(false);
  const now = useNow(state.clockOffset);
  const round = state.round;
  const def = round ? MODE_DEFS[round.mode] : undefined;
  const playing = round?.phase === 'playing' && state.conn === 'open';
  const fogOn = !!def?.fog && round?.phase === 'playing';
  const winner = state.players.find((p) => p.pid === state.winnerPid);
  const unit = def?.scoreUnit ?? 'percent';

  const shrinking = round?.mode === 'shrink' ? round : null;
  const allow = useMemo(
    () => (shrinking ? (x: number, y: number) => inCircle({ x, y }, ringAt(shrinking, Date.now() + state.clockOffset)) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shrinking?.idx, shrinking?.startsAt, shrinking?.overAt, state.clockOffset],
  );

  return (
    <div className="gallery">
      <header className="marquee">
        <span>Canvas Gallery</span>
        {state.conn === 'replaced' ? (
          <button className="takeover" onClick={onTakeOver}>Open in another tab — click to play here</button>
        ) : (
          <span className="conn">{state.conn === 'open' ? '' : state.conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        )}
        <button className="leave" onClick={onLeave}>Not you?</button>
      </header>
      <main className="wall">
        <Leaderboard players={state.players} shares={state.shares} you={state.you} fogged={fogOn} unit={unit} />
        <section className="centerpiece">
          <div className="frame">
            <div className="mat">
              <div className="canvas-wrap">
                <PaintCanvas
                  send={send} subscribe={subscribe} opLog={opLog} players={state.players} you={state.you} enabled={playing}
                  brush={round?.brush ?? 6} eraseBrush={def?.eraseBrush} erasing={erasing} allow={allow} cursors={cursors}
                />
                <FogLayer active={fogOn} you={state.you} players={state.players} opLog={opLog} brush={round?.brush ?? 6} />
                <CursorLayer cursors={cursors} players={state.players} you={state.you} hidden={fogOn} />
                {round && <OverlayLayer shapes={overlayShapes(MODE_DEFS[round.mode], round, now, state.modeState)} />}
                {round?.phase === 'over' && (
                  <RoundOver round={round} winner={winner} share={state.shares[state.winnerPid ?? -1] ?? 0} now={now} unit={unit} />
                )}
              </div>
            </div>
          </div>
          {def?.eraseBrush !== undefined && playing && (
            <button className={`eraser-toggle${erasing ? ' on' : ''}`} onClick={() => setErasing((e) => !e)} aria-pressed={erasing}>
              Eraser {erasing ? 'on' : 'off'} · or hold Shift
            </button>
          )}
          <Plaque round={round} now={now} />
        </section>
        <PastRounds history={state.history} getRoundOps={getRoundOps} />
      </main>
      <div className="floor" />
    </div>
  );
}
