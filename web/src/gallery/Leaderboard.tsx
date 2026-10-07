import type { PlayerInfo } from '@gallery/shared';
import { groupByTeam } from './teamBoard';

interface Props { players: PlayerInfo[]; shares: Record<number, number>; you: number | null; fogged?: boolean }

export function Leaderboard({ players, shares, you, fogged }: Props) {
  if (fogged) {
    const me = players.find((p) => p.pid === you);
    return (
      <aside className="placard">
        <h2>Scores</h2>
        <p className="fog-note">Hidden in the fog until the round ends.</p>
        {me && (
          <ol>
            <li className="me">
              <span className="swatch" style={{ background: me.color }} />
              <span className="lb-name">{me.name}</span>
              <span className="lb-pct">{((shares[me.pid] ?? 0) * 100).toFixed(1)}%</span>
              <span />
            </li>
          </ol>
        )}
      </aside>
    );
  }

  const teams = groupByTeam(players, shares);
  if (teams) {
    return (
      <aside className="placard">
        <h2>Teams</h2>
        <ol>
          {teams.map((t) => (
            <li key={t.team} className="team-row">
              <span className="swatch" style={{ background: t.color }} />
              <span className="lb-name">{t.name}</span>
              <span className="lb-pct">{(t.share * 100).toFixed(1)}%</span>
              <span />
              <span className="team-members">
                {t.members.map((m) => (
                  <span key={m.pid} className={m.pid === you ? 'me' : ''} style={{ opacity: m.online ? 1 : 0.5 }}>
                    <span className="swatch small" style={{ background: m.color }} />{m.name}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </aside>
    );
  }

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
