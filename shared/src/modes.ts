import type { ModeId, ModeState, NextModeInfo } from './protocol';

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
  overlay?: (round: OverlayRound, now: number, state: ModeState | null) => OverlayShape[];
}

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
};

export function overlayShapes(def: ModeDef, round: OverlayRound, now: number, state: ModeState | null): OverlayShape[] {
  return def.overlay ? def.overlay(round, now, state) : [];
}

export function nextModeInfo(idx: number, order: readonly ModeId[]): NextModeInfo {
  const id = order[(idx + 1) % order.length]!;
  const d = MODE_DEFS[id];
  return { mode: id, name: d.name, rules: d.rules, howTo: d.howTo, brush: d.brush };
}
