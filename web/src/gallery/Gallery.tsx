import { useRef, type ReactNode } from 'react';
import type { ClientMsg, Op, ServerMsg } from '@gallery/shared';
import type { RoomState } from '../state/roomReducer';
import { PaintCanvas, type CursorMap } from '../canvas/PaintCanvas';
import { CursorLayer } from '../canvas/CursorLayer';
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
  onLeave: () => void;
  children?: ReactNode;
}

export function Gallery({ state, send, subscribe, getRoundOps, opLog, onLeave }: Props) {
  const cursors = useRef<CursorMap>(new Map());
  const now = useNow(state.clockOffset);
  const round = state.round;
  const playing = round?.phase === 'playing' && state.conn === 'open';
  const winner = state.players.find((p) => p.pid === state.winnerPid);

  return (
    <div className="gallery">
      <header className="marquee">
        <span>Canvas Gallery</span>
        <span className="conn">{state.conn === 'open' ? '' : state.conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        <button className="leave" onClick={onLeave}>Not you?</button>
      </header>
      <main className="wall">
        <Leaderboard players={state.players} shares={state.shares} you={state.you} />
        <section className="centerpiece">
          <div className="frame">
            <div className="mat">
              <div className="canvas-wrap">
                <PaintCanvas
                  send={send} subscribe={subscribe} opLog={opLog} players={state.players} you={state.you} enabled={playing} brush={round?.brush ?? 6} cursors={cursors}
                />
                <CursorLayer cursors={cursors} players={state.players} you={state.you} />
                {round?.phase === 'over' && (
                  <RoundOver round={round} winner={winner} share={state.shares[state.winnerPid ?? -1] ?? 0} now={now} />
                )}
              </div>
            </div>
          </div>
          <Plaque round={round} now={now} />
        </section>
        <PastRounds history={state.history} getRoundOps={getRoundOps} />
      </main>
      <div className="floor" />
    </div>
  );
}
