import type { ModeId, ModeState, NextModeInfo } from './protocol';
import { scheduledMode } from './schedule';
import { flagAt, hillAt, hotZones, ringAt } from './zones';

export type OverlayShape =
  | { kind: 'circle'; x: number; y: number; r: number; label?: string; tone: 'zone' | 'flag' | 'hill' }
  | { kind: 'ring'; x: number; y: number; r: number };

export interface OverlayRound { idx: number; startsAt: number; overAt: number }

export interface ModeDef {
  id: ModeId;
  name: string;
  rules: string;
  howTo: string[];
  brush: number;
  /** Players can erase with this brush radius (Shift or the Eraser toggle). */
  eraseBrush?: number;
  /** Other players' ink is hidden except near your cursor until the round is over. */
  fog?: boolean;
  overlay?: (round: OverlayRound, now: number, state: ModeState | null) => OverlayShape[];
}

const WIN = 'Whoever scores the most when time runs out wins.';

export const MODE_DEFS: Record<ModeId, ModeDef> = {
  paint: {
    id: 'paint',
    name: 'Paint War',
    rules: 'Cover as much of the canvas as you can. Paint over others to steal their ground.',
    howTo: [
      'Draw to claim ground in your color.',
      'Paint over other people to steal their territory.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 6,
  },
  splat: {
    id: 'splat',
    name: 'Splat',
    rules: 'Your brush is huge. Splat big blobs and grab ground fast.',
    howTo: [
      'Your brush is giant: click or drag to splat big blobs.',
      'Big blobs steal ground fast, so watch your edges.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 20,
  },
  hotzones: {
    id: 'hotzones',
    name: 'Hot Zones',
    rules: 'Three glowing zones are worth 5x. Own them.',
    howTo: [
      'Three dashed zones are marked on the canvas.',
      'Ground inside a zone counts five times as much.',
      'Fight for the zones, then fill in around them.',
      WIN,
    ],
    brush: 6,
    overlay: (round) => hotZones(round.idx).map((c) => ({ kind: 'circle' as const, ...c, label: '5×', tone: 'zone' as const })),
  },
  hill: {
    id: 'hill',
    name: 'King of the Hill',
    rules: 'Paint on the hill to earn points. The hill moves every 10 seconds.',
    howTo: [
      'A green hill is marked on the canvas and jumps every 10 seconds.',
      'Every bit of ink you lay on the hill earns hill points.',
      'Your score is 60% territory and 40% your share of the hill points.',
      WIN,
    ],
    brush: 6,
    overlay: (round, now) => [{ kind: 'circle', ...hillAt(round.idx, round.startsAt, now), label: 'HILL', tone: 'hill' }],
  },
  enclose: {
    id: 'enclose',
    name: 'Lasso',
    rules: 'Draw a line that loops back and crosses your own line. The loop fills with your color.',
    howTo: [
      'Draw a line that crosses itself, or crosses your earlier line.',
      'The loop you close fills with your color.',
      'Loops can only close on your own lines.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 6,
  },
  ctf: {
    id: 'ctf',
    name: 'Capture the Flag',
    rules: 'Loop a lasso around the flag to capture it for bonus points.',
    howTo: [
      'This is Lasso: cross your own line to close a loop that fills with your color.',
      'Close a loop around the flag to capture it: +8% bonus per capture.',
      'After a capture the flag jumps somewhere else.',
      WIN,
    ],
    brush: 6,
    overlay: (round, _now, state) => [{ kind: 'circle', ...flagAt(round.idx, Number(state?.n ?? 0)), label: 'FLAG', tone: 'flag' }],
  },
  fog: {
    id: 'fog',
    name: 'Fog of War',
    rules: 'You can only see your own ink and a small circle around your cursor.',
    howTo: [
      'Fog covers the canvas: you see your own ink and a lantern around your cursor.',
      'Other players and the scores are hidden until the round ends.',
      'Paint as much as you can and guess where the others are.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 6,
    fog: true,
  },
  eraser: {
    id: 'eraser',
    name: 'Eraser Wars',
    rules: 'Paint to claim ground and erase to take it from others.',
    howTo: [
      'Paint normally to claim ground.',
      'Hold Shift or switch on the Eraser button to erase with a wide brush.',
      'Erased ground belongs to nobody, so attack and defend.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 6,
    eraseBrush: 20,
  },
  shrink: {
    id: 'shrink',
    name: 'Shrinking Zone',
    rules: 'The safe area shrinks. You can only paint inside it.',
    howTo: [
      'The ring shrinks toward the middle all round long.',
      'You can only paint inside the ring.',
      'Ground you already painted outside still counts.',
      'Whoever owns the most canvas when time runs out wins.',
    ],
    brush: 6,
    overlay: (round, now) => [{ kind: 'ring', ...ringAt(round, now) }],
  },
  teams: {
    id: 'teams',
    name: 'Team Tug-of-War',
    rules: 'Teams fight for ground. The team with the most canvas wins.',
    howTo: [
      'You are put on a team; your ink uses your team colors.',
      'Your team score is everyone on your team added together.',
      'Paint over the other teams to steal their ground.',
      'The team with the most canvas when time runs out wins.',
    ],
    brush: 6,
  },
};

export function overlayShapes(def: ModeDef, round: OverlayRound, now: number, state: ModeState | null): OverlayShape[] {
  return def.overlay ? def.overlay(round, now, state) : [];
}

/** The mode after round `idx`: cyclic through `order` if given (tests), otherwise the random schedule. */
export function nextModeInfo(idx: number, order?: readonly ModeId[]): NextModeInfo {
  const id = order ? order[(idx + 1) % order.length]! : scheduledMode(idx + 1);
  const d = MODE_DEFS[id];
  return { mode: id, name: d.name, rules: d.rules, howTo: d.howTo, brush: d.brush };
}
