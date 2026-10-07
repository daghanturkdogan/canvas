import type { PlayerInfo, RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';
import { winnerLabel } from './teamBoard';
import { formatScore, type ScoreUnit } from './score';

interface Props { round: RoundInfo; winner: PlayerInfo | undefined; share: number; now: number; unit?: ScoreUnit }

export function RoundOver({ round, winner, share, now, unit = 'percent' }: Props) {
  const label = winnerLabel(winner);
  return (
    <div className="round-over">
      <div className="round-over-stack">
        <div className="round-over-card">
          <div className="eyebrow">Round over</div>
          {label ? (
            <>
              <div className="winner" style={{ color: label.color }}>{label.text}</div>
              <div className="winner-line">wins with {formatScore(share, unit)}</div>
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
