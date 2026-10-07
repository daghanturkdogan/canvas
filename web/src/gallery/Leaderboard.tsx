import type { PlayerInfo } from '@gallery/shared';

interface Props { players: PlayerInfo[]; shares: Record<number, number>; you: number | null }

export function Leaderboard({ players, shares, you }: Props) {
  const rows = players
    .map((p) => ({ ...p, share: shares[p.pid] ?? 0 }))
    .filter((p) => p.online || p.share > 0)
    .sort((a, b) => b.share - a.share || b.wins - a.wins || a.name.localeCompare(b.name));
  return (
    <aside className="placard">
      <h2>Territory</h2>
      <ol>
        {rows.map((r) => (
          <li key={r.pid} className={r.pid === you ? 'me' : ''} style={{ opacity: r.online || r.share > 0 ? 1 : 0.45 }}>
            <span className="swatch" style={{ background: r.color }} />
            <span className="lb-name">{r.name}</span>
            <span className="lb-pct">{(r.share * 100).toFixed(1)}%</span>
            <span className="lb-wins" title="Rounds won">{r.wins > 0 ? `★${r.wins}` : ''}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="empty">No artists yet</li>}
      </ol>
    </aside>
  );
}
