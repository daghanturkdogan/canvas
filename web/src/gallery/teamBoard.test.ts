import { describe, it, expect } from 'vitest';
import { groupByTeam, winnerLabel } from './teamBoard';
import { TEAMS, type PlayerInfo } from '@gallery/shared';

const P = (pid: number, name: string, team?: number, online = true): PlayerInfo => ({
  pid, name, color: '#abc', online, wins: 0, ...(team === undefined ? {} : { team }),
});

describe('groupByTeam', () => {
  it('returns null when nobody is on a team', () => {
    expect(groupByTeam([P(1, 'A'), P(2, 'B')], { 1: 0.2 })).toBeNull();
  });

  it('groups players by team and sorts teams by score', () => {
    const rows = groupByTeam([P(1, 'A', 0), P(2, 'B', 1), P(3, 'C', 0), P(4, 'D', 1)], { 1: 0.1, 3: 0.1, 2: 0.3, 4: 0.3 })!;
    expect(rows.map((r) => r.team)).toEqual([1, 0]);
    expect(rows[0]!.members.map((m) => m.name)).toEqual(['B', 'D']);
    expect(rows[0]!.share).toBeCloseTo(0.3);
    expect(rows[0]!.name).toBe(TEAMS[1]!.name);
  });

  it('shows a team with no score yet at 0', () => {
    const rows = groupByTeam([P(1, 'A', 0), P(2, 'B', 1)], { 1: 0.2 })!;
    expect(rows.find((r) => r.team === 1)!.share).toBe(0);
  });

  it('ignores players that are not on a team', () => {
    const rows = groupByTeam([P(1, 'A', 0), P(2, 'B')], {})!;
    expect(rows.length).toBe(1);
  });
});

describe('winnerLabel', () => {
  it('names the team for team winners', () => {
    expect(winnerLabel(P(1, 'A', 2))).toEqual({ text: `Team ${TEAMS[2]!.name}`, color: TEAMS[2]!.color });
  });
  it('names the player otherwise', () => {
    expect(winnerLabel(P(1, 'A'))).toEqual({ text: 'A', color: '#abc' });
  });
  it('returns null when there is no winner', () => {
    expect(winnerLabel(undefined)).toBeNull();
  });
});
