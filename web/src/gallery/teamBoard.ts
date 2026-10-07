import { TEAMS, type PlayerInfo } from '@gallery/shared';

export interface TeamRow {
  team: number;
  name: string;
  color: string;
  share: number;
  members: { pid: number; name: string; color: string; online: boolean }[];
}

/** Team rows for the leaderboard, or null when nobody is on a team. Every member carries the team score. */
export function groupByTeam(players: PlayerInfo[], shares: Record<number, number>): TeamRow[] | null {
  const onTeams = players.filter((p) => p.team !== undefined);
  if (onTeams.length === 0) return null;
  const rows = new Map<number, TeamRow>();
  for (const p of onTeams) {
    const team = p.team!;
    const def = TEAMS[team % TEAMS.length]!;
    const row = rows.get(team) ?? { team, name: def.name, color: def.color, share: 0, members: [] };
    row.members.push({ pid: p.pid, name: p.name, color: p.color, online: p.online });
    row.share = Math.max(row.share, shares[p.pid] ?? 0);
    rows.set(team, row);
  }
  return [...rows.values()].sort((a, b) => b.share - a.share || a.team - b.team);
}

/** Who to announce on the winner card: a team name for team modes, otherwise the player. */
export function winnerLabel(winner: PlayerInfo | undefined): { text: string; color: string } | null {
  if (!winner) return null;
  if (winner.team !== undefined) {
    const def = TEAMS[winner.team % TEAMS.length]!;
    return { text: `Team ${def.name}`, color: def.color };
  }
  return { text: winner.name, color: winner.color };
}
