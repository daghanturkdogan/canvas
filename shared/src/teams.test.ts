import { describe, it, expect } from 'vitest';
import { TEAMS, teamCountFor, teamShade } from './teams';

describe('teamCountFor', () => {
  it('scales with the number of players, between 2 and 4 teams', () => {
    expect(teamCountFor(0)).toBe(2);
    expect(teamCountFor(1)).toBe(2);
    expect(teamCountFor(5)).toBe(2);
    expect(teamCountFor(6)).toBe(2);
    expect(teamCountFor(8)).toBe(2);
    expect(teamCountFor(9)).toBe(3);
    expect(teamCountFor(11)).toBe(3);
    expect(teamCountFor(12)).toBe(4);
    expect(teamCountFor(24)).toBe(4);
  });
});

describe('TEAMS', () => {
  it('has 4 named teams with 6 shades each, all different colors', () => {
    expect(TEAMS.length).toBe(4);
    const all = TEAMS.flatMap((t) => t.shades);
    expect(new Set(all).size).toBe(all.length);
    for (const t of TEAMS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.shades.length).toBe(6);
    }
  });

  it('picks a shade by member index and wraps', () => {
    expect(teamShade(1, 0)).toBe(TEAMS[1]!.shades[0]);
    expect(teamShade(1, 6)).toBe(TEAMS[1]!.shades[0]);
  });
});
