import type { RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';

export function Plaque({ round, now }: { round: RoundInfo | null; now: number }) {
  if (!round) return <div className="plaque"><div className="plaque-title">Hanging the next piece…</div></div>;
  const playing = round.phase === 'playing';
  return (
    <div className="plaque">
      <div className="plaque-title">{round.modeName}</div>
      <div className="plaque-rules">{round.rules}</div>
      <div className="plaque-clock">
        {playing ? `Ends in ${formatCountdown(round.overAt - now)}` : `Next round in ${formatCountdown(round.endsAt - now)}`}
      </div>
    </div>
  );
}
