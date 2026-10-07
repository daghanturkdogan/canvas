import type { PlayerInfo, RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';

interface Props { round: RoundInfo; winner: PlayerInfo | undefined; share: number; now: number }

export function RoundOver({ round, winner, share, now }: Props) {
  return (
    <div className="round-over">
      <div className="round-over-stack">
        <div className="round-over-card">
          <div className="eyebrow">Round over</div>
          {winner ? (
            <>
              <div className="winner" style={{ color: winner.color }}>{winner.name}</div>
              <div className="winner-line">wins with {(share * 100).toFixed(1)}%</div>
            </>
          ) : (
            <div className="winner-line">Nobody painted this round</div>
          )}
          <div className="next">Next canvas in {formatCountdown(round.endsAt - now)}</div>
        </div>
        <div className="upnext-card">
          <div className="eyebrow">Up next</div>
          <div className="upnext-title">{round.next.name}</div>
          <ul>
            {round.next.howTo.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
