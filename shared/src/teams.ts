export interface TeamDef { name: string; color: string; shades: string[] }

/** Four teams, each its own color family with six shades (one per member, wrapping). */
export const TEAMS: readonly TeamDef[] = [
  { name: 'Ember', color: '#e8553d', shades: ['#e8553d', '#ff7a45', '#c9301c', '#ff9d5c', '#b3541e', '#f2b134'] },
  { name: 'Tide', color: '#2b7de9', shades: ['#2b7de9', '#00a6d6', '#1b4fb3', '#4cc9f0', '#0b6e99', '#7aa7ff'] },
  { name: 'Grove', color: '#2fa84f', shades: ['#2fa84f', '#7bc043', '#1b7a3a', '#a3d977', '#0f8f6b', '#5fd0a0'] },
  { name: 'Violet', color: '#8e44ad', shades: ['#8e44ad', '#c06cd8', '#6c2c8a', '#d98be8', '#5b3a9e', '#b39ddb'] },
];

/** More players, more teams: about three players per team, between 2 and 4 teams. */
export function teamCountFor(online: number): number {
  return Math.min(4, Math.max(2, Math.floor(online / 3)));
}

export function teamShade(team: number, memberIndex: number): string {
  const t = TEAMS[team % TEAMS.length]!;
  return t.shades[memberIndex % t.shades.length]!;
}
