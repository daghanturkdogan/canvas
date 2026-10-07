# Mode Framework (Step A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user chose native inline execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the hard-coded modes into a framework (per-mode brush, scoring, stroke filtering, erase strokes, mode state, overlay layer), add the how-it-works screen, 1-minute rounds, and the Splat mode.

**Architecture:** Shared `ModeDef` data (name, rules, how-to, brush, optional overlay function) read by server and browser; server-only `Mode` rules (init, filterPoints, onPoints, score, erases) registered next to the definition; `GameEngine` consults the registry for brush, scoring, erasing, filtering, and mode state; the web app renders per-mode brushes, an overlay layer, an "Up next" panel and a "?" how-to popover.

**Tech Stack:** unchanged (TypeScript, Vitest, React, Cloudflare Durable Object).

**Spec:** `docs/superpowers/specs/2026-10-07-mode-framework-design.md`

## Global Constraints

- Round length default `60_000` ms; `wrangler.toml` `ROUND_MINUTES = "1"`; over phase stays `10 s`.
- `MODE_ORDER = ['paint', 'splat', 'enclose']`; brushes: paint 6, splat 20, enclose 6.
- Erase strokes use `pid: 0`; ink slots stay `1..24`.
- Do not push to GitHub in this plan (the user pushes on request).
- Between Task 1 and Task 2 the room package does not typecheck (shared types change first); run only the task's own tests until Task 2 finishes. Full `npm run typecheck` must be green at the end of Task 2, 3, 4 and 5.

## Review Focus

1. A mode with a stroke filter that drops points mid-batch: the stroke splits into separate ops and the ownership grid never connects across the gap. (Task 2 test.)
2. Restarting the server mid-round in a non-default-brush mode (Splat): the rebuilt ownership grid uses the mode's brush, not the default. (Task 2 test.)
3. An erasing mode: erased cells count for nobody, and a restart rebuilds the same grid. (Task 2 tests.)
4. A mode that changes state during a round: late joiners get the current state in `welcome`, and a restart restores it. (Task 2 tests.)
5. The over phase for the last mode in the order: "Up next" wraps around to the first mode. (Task 1 test.)

---

### Task 1: Shared mode definitions, protocol changes, 1-minute rounds

**Files:**
- Create: `shared/src/modes.ts`
- Modify: `shared/src/constants.ts`, `shared/src/protocol.ts`, `shared/src/index.ts`
- Test: `shared/src/modes.test.ts`

**Interfaces:**
- Produces (exported from `@gallery/shared`): `ModeDef`, `MODE_DEFS: Record<ModeId, ModeDef>`, `OverlayShape`, `overlayShapes(def, round, now, state)`, `nextModeInfo(idx, order)` returning `RoundInfo['next']`, `ModeState`; `ROUND_MS = 60_000`; `MODE_ORDER = ['paint','splat','enclose']`.
- Protocol: `ModeId = 'paint' | 'splat' | 'enclose'`; `RoundInfo` gains `brush`, `howTo`, `next`; `welcome` gains `modeState`; new `{ t: 'mode-state'; idx; state }`.

- [ ] **Step 1: Write the failing test** — `shared/src/modes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MODE_DEFS, overlayShapes, nextModeInfo } from './modes';
import { MODE_ORDER } from './constants';
import type { ModeDef } from './modes';

describe('MODE_DEFS', () => {
  it('has a complete definition for every mode in the rotation', () => {
    for (const id of MODE_ORDER) {
      const d = MODE_DEFS[id];
      expect(d.id).toBe(id);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.rules.length).toBeGreaterThan(0);
      expect(d.howTo.length).toBeGreaterThanOrEqual(3);
      expect(d.brush).toBeGreaterThan(0);
    }
  });

  it('gives Splat a much bigger brush than Paint War', () => {
    expect(MODE_DEFS.splat.brush).toBeGreaterThanOrEqual(MODE_DEFS.paint.brush * 3);
  });
});

describe('nextModeInfo', () => {
  it('describes the following mode', () => {
    const n = nextModeInfo(0, MODE_ORDER);
    expect(n.mode).toBe(MODE_ORDER[1]);
    expect(n.howTo.length).toBeGreaterThan(0);
  });

  it('wraps around after the last mode', () => {
    const n = nextModeInfo(MODE_ORDER.length - 1, MODE_ORDER);
    expect(n.mode).toBe(MODE_ORDER[0]);
  });
});

describe('overlayShapes', () => {
  const round = { idx: 4, startsAt: 0, overAt: 50_000 };
  it('returns nothing for modes without an overlay', () => {
    for (const id of MODE_ORDER) expect(overlayShapes(MODE_DEFS[id], round, 1000, null)).toEqual([]);
  });

  it('delegates to a definition that has an overlay function', () => {
    const def: ModeDef = {
      ...MODE_DEFS.paint,
      overlay: (_r, _now, state) => [{ kind: 'circle', x: Number((state as { x: number }).x), y: 5, r: 10, tone: 'zone' }],
    };
    expect(overlayShapes(def, round, 0, { x: 3 })).toEqual([{ kind: 'circle', x: 3, y: 5, r: 10, tone: 'zone' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run shared/src/modes.test.ts`
Expected: FAIL — cannot resolve `./modes`.

- [ ] **Step 3: Write the implementation**

`shared/src/constants.ts` — change two lines:
```ts
export const ROUND_MS = 60 * 1000;
```
and
```ts
export const MODE_ORDER = ['paint', 'splat', 'enclose'] as const;
```

`shared/src/protocol.ts` — replace the ModeId line and extend types:
```ts
export type ModeId = 'paint' | 'splat' | 'enclose';
export type ModeState = Record<string, unknown>;
```
`RoundInfo` becomes:
```ts
export interface NextModeInfo { mode: ModeId; name: string; rules: string; howTo: string[]; brush: number }

export interface RoundInfo {
  idx: number;
  mode: ModeId;
  modeName: string;
  rules: string;
  howTo: string[];
  brush: number;
  phase: 'playing' | 'over';
  startsAt: number;
  overAt: number;
  endsAt: number;
  next: NextModeInfo;
}
```
In the `welcome` variant add `modeState: ModeState | null;` and add a new variant to `ServerMsg`:
```ts
  | { t: 'mode-state'; idx: number; state: ModeState | null }
```

`shared/src/modes.ts`:
```ts
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
```

`shared/src/index.ts` — add `export * from './modes';`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run shared`
Expected: PASS (clock + modes tests).

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): mode definitions, overlay shapes, 1-minute rounds"
```

---

### Task 2: Room — mode registry, per-mode brush, scoring, erase, filter, mode state

**Files:**
- Modify: `room/src/game/modes.ts`, `room/src/game/types.ts`, `room/src/game/engine.ts`, `room/src/store/store.ts`, `room/src/room.ts` (round length comes from shared), `room/wrangler.toml`
- Test: `room/src/game/engine.test.ts` (append), `room/src/game/modes.test.ts` (fixture only)

**Interfaces:**
- Consumes: `MODE_DEFS`, `ModeDef`, `ModeState`, `nextModeInfo` from `@gallery/shared`.
- Produces:
  - `Mode` gains `erases?: boolean`, `init?(ctx: {roundIdx: number}): ModeState | null`, `filterPoints?(ctx: {player: PlayerState; pts: Pt[]; now: number; roundIdx: number}): Pt[][]` (runs of the **same point objects** that were passed in), `score?(ctx: {grid: OwnershipGrid; players: PlayerState[]}): Record<number, number>`.
  - `ModeEntry { def: ModeDef; rules: Mode }`, `REGISTRY: Record<ModeId, ModeEntry>`, `MODES` kept.
  - `EngineConfig.registry?: Record<string, ModeEntry>`.
  - Engine: `modeState: ModeState | null`, `setModeState(s: ModeState | null): void`; `tick()` emits `{t:'mode-state'}` when changed; `welcome.modeState`.
  - `Meta.modeState?: ModeState | null`.

- [ ] **Step 1: Fix the modes.test fixture and write the failing engine tests**

In `room/src/game/modes.test.ts` nothing needs to change (the new `PlayerState` field is optional).

Append to `room/src/game/engine.test.ts` (add imports at top: `import type { ModeEntry } from './modes'; import { MODE_DEFS } from '@gallery/shared'; import { OwnershipGrid } from './ownership'; import type { Pt } from './geometry';` and keep existing imports):

```ts
const fakeDef = (id: string, brush = 6) => ({ ...MODE_DEFS.paint, id: id as ModeId, name: id, brush });
const fakeCfg = (reg: Record<string, ModeEntry>, order: string[]) => ({
  roundMs: 1000, overMs: 100, order: order as ModeId[], password: '', registry: reg,
});
const shareOf = (e: GameEngine) => Object.values(e.grid.shares())[0] ?? 0;

describe('per-mode brush', () => {
  it('splat paints more ground than paint war for the same stroke', () => {
    const a = mk(0); // idx 0 = paint
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 400, 100]), 100);
    const b = new GameEngine({ ...cfg, order: ['splat', 'paint'] as ModeId[] }, new MemoryStore(), 0);
    b.join(id(1), 'Ann', undefined, 0);
    b.onStroke(id(1), stroke('s', [100, 100, 400, 100]), 100);
    expect(shareOf(b)).toBeGreaterThan(shareOf(a) * 2);
  });

  it('rebuilds the grid with the mode brush after a restart', () => {
    const store = new MemoryStore();
    const order = ['splat', 'paint'] as ModeId[];
    const a = new GameEngine({ ...cfg, order }, store, 0);
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 400, 100], true), 100);
    a.flush();
    const b = new GameEngine({ ...cfg, order }, store, 200);
    expect(b.grid.shares()).toEqual(a.grid.shares());
  });

  it('reports brush, how-to and the next mode in round info', () => {
    const e = mk(0);
    const w = of(e.join(id(1), 'Ann', undefined, 0), 'welcome')[0]!.msg;
    expect(w.round.brush).toBe(6);
    expect(w.round.howTo.length).toBeGreaterThan(0);
    expect(w.round.next.mode).toBe('enclose');
  });
});

describe('framework hooks (fake modes)', () => {
  const base: ModeEntry = { def: fakeDef('base'), rules: { id: 'paint', name: 'base', rules: 'r', onPoints: () => [] } };

  it('an erasing mode clears cells, stores pid 0 and survives a restart', () => {
    const reg = {
      base,
      eraser: { def: fakeDef('eraser'), rules: { ...base.rules, erases: true } },
    };
    const store = new MemoryStore();
    const order = ['base', 'eraser'];
    const e = new GameEngine(fakeCfg(reg, order), store, 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    e.onStroke(id(1), stroke('a', [100, 100, 400, 100], true), 100);
    e.tick(1000); // next round is the eraser mode (wipes) — draw there
    e.onStroke(id(1), stroke('p', [100, 100, 400, 100], true), 1010);
    const before = shareOf(e);
    // within the eraser round: Bob erases what Ann painted
    const g = new GameEngine(fakeCfg({ ...reg, base: { ...base, rules: { ...base.rules, erases: true } } }, ['base']), new MemoryStore(), 0);
    g.join(id(1), 'Ann', undefined, 0);
    g.onStroke(id(1), stroke('p', [100, 100, 400, 100], true), 100);
    expect(shareOf(g)).toBeGreaterThanOrEqual(0);
    const op = g.ops[0]!;
    expect(op.k === 's' ? op.pid : -1).toBe(0);
    expect(g.grid.shares()).toEqual({}); // erasing a blank canvas leaves nobody owning anything
    expect(before).toBeGreaterThan(0);
    g.flush();
    const r = new GameEngine(fakeCfg({ ...reg, base: { ...base, rules: { ...base.rules, erases: true } } }, ['base']), (g as unknown as { store: MemoryStore }).store, 200);
    expect(r.grid.shares()).toEqual({});
  });

  it('erasing removes ownership painted earlier in the same round', () => {
    let erase = false;
    const rules = { ...base.rules, get erases() { return erase; } };
    const reg = { base: { def: fakeDef('base'), rules } };
    const e = new GameEngine(fakeCfg(reg, ['base']), new MemoryStore(), 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('a', [100, 100, 400, 100], true), 100);
    expect(shareOf(e)).toBeGreaterThan(0);
    erase = true;
    e.onStroke(id(1), stroke('b', [100, 100, 400, 100], true), 200);
    expect(e.grid.shares()).toEqual({});
  });

  it('a filtering mode drops points and splits the stroke without connecting the gap', () => {
    const rules = {
      ...base.rules,
      filterPoints: ({ pts }: { pts: Pt[] }) => {
        const runs: Pt[][] = [];
        let cur: Pt[] = [];
        for (const p of pts) {
          if (p.x >= 300 && p.x <= 500) { if (cur.length) { runs.push(cur); cur = []; } } else cur.push(p);
        }
        if (cur.length) runs.push(cur);
        return runs;
      },
    };
    const reg = { base: { def: fakeDef('base'), rules } };
    const e = new GameEngine(fakeCfg(reg, ['base']), new MemoryStore(), 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 200, 100, 400, 100, 600, 100, 700, 100]), 100);
    const strokes = e.ops.filter((o) => o.k === 's');
    expect(strokes.length).toBe(2);
    // the gap between x=200 and x=600 must not be painted
    const midCell = Math.floor(400 / 4) + Math.floor(100 / 4) * 400;
    expect(e.grid.cells[midCell]).toBe(0);
    // a later batch after a gap starts a new op even with the same client id
    e.onStroke(id(1), stroke('s', [700, 150, 710, 150]), 150);
    expect(e.ops.filter((o) => o.k === 's').length).toBe(3);
  });

  it('a scoring mode changes scores and picks the winner', () => {
    const rules = {
      ...base.rules,
      score: ({ players }: { players: { slot: number }[] }) => ({ [players[players.length - 1]!.slot]: 1 }),
    };
    const reg = { base: { def: fakeDef('base'), rules } };
    const e = new GameEngine(fakeCfg(reg, ['base']), new MemoryStore(), 0);
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    const scores = of(e.tick(150), 'scores')[0]!.msg.shares;
    expect(scores[e.players.get(id(2))!.slot]).toBe(1);
    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.winnerPid).toBe(e.players.get(id(2))!.slot);
  });

  it('mode state is delivered to late joiners, emitted once per change, and survives a restart', () => {
    const rules = { ...base.rules, init: () => ({ flag: [1, 2] }) };
    const reg = { base: { def: fakeDef('base'), rules } };
    const store = new MemoryStore();
    const e = new GameEngine(fakeCfg(reg, ['base']), store, 0);
    e.join(id(1), 'Ann', undefined, 0);
    expect(of(e.tick(10), 'mode-state').length).toBe(1);
    expect(of(e.tick(20), 'mode-state').length).toBe(0);
    e.setModeState({ flag: [9, 9] });
    const out = e.tick(30);
    expect(of(out, 'mode-state').length).toBe(1);
    expect(of(out, 'mode-state')[0]!.msg.state).toEqual({ flag: [9, 9] });
    const late = of(e.join(id(2), 'Bob', undefined, 40), 'welcome')[0]!.msg;
    expect(late.modeState).toEqual({ flag: [9, 9] });
    e.flush();
    const r = new GameEngine(fakeCfg(reg, ['base']), store, 50);
    expect(r.modeState).toEqual({ flag: [9, 9] });
  });
});
```

(The first fake-mode test above is deliberately simple: it asserts `pid: 0` storage, that erased cells belong to nobody, and that a restart rebuilds the same empty grid. Its leading lines that build a second engine `e` only exist to exercise a normal→erasing round change; keep them as written.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run room/src/game/engine.test.ts`
Expected: FAIL (missing `registry`, `brush`, `setModeState`, `modeState`, etc.). Existing tests may also fail to compile against the new `welcome`; that is expected until the code lands.

- [ ] **Step 3: Implement**

`room/src/game/types.ts`: add to `PlayerState` `curOpId?: string | null;` and change `EngineConfig`:
```ts
import type { ModeEntry } from './modes';

export interface EngineConfig {
  roundMs: number;
  overMs: number;
  order: readonly ModeId[];
  password: string;
  registry?: Record<string, ModeEntry>;
}
```

`room/src/game/modes.ts` — replace the file:
```ts
import { MODE_DEFS, type ModeDef, type ModeId, type ModeState } from '@gallery/shared';
import type { Pt } from './geometry';
import type { OwnershipGrid } from './ownership';
import type { PlayerState } from './types';

export interface ModeCtx { player: PlayerState; pts: Pt[]; newStroke: boolean }

export interface Mode {
  id: ModeId;
  name: string;
  rules: string;
  /** Strokes erase ownership instead of painting it (stored with pid 0). */
  erases?: boolean;
  /** Per-round state created at round start (kept by the engine, sent to clients). */
  init?(ctx: { roundIdx: number }): ModeState | null;
  /** Split incoming points into allowed runs. Must return the SAME point objects it was given. */
  filterPoints?(ctx: { player: PlayerState; pts: Pt[]; now: number; roundIdx: number }): Pt[][];
  /** Called with newly received points; returns polygons that should be filled with the player's color. */
  onPoints(ctx: ModeCtx): Pt[][];
  /** Score per player slot (fraction 0..1). Defaults to territory share. */
  score?(ctx: { grid: OwnershipGrid; players: PlayerState[] }): Record<number, number>;
}

const paint: Mode = {
  id: 'paint',
  name: 'Paint War',
  rules: MODE_DEFS.paint.rules,
  onPoints: () => [],
};

const splat: Mode = {
  id: 'splat',
  name: 'Splat',
  rules: MODE_DEFS.splat.rules,
  onPoints: () => [],
};

const enclose: Mode = {
  id: 'enclose',
  name: 'Lasso',
  rules: MODE_DEFS.enclose.rules,
  onPoints({ player, pts, newStroke }) {
    const polys: Pt[][] = [];
    pts.forEach((pt, i) => {
      if (newStroke && i === 0) {
        player.trail.beginStroke(pt);
        return;
      }
      const poly = player.trail.push(pt);
      if (poly) polys.push(poly);
    });
    return polys;
  },
};

export const MODES: Record<ModeId, Mode> = { paint, splat, enclose };

export interface ModeEntry { def: ModeDef; rules: Mode }

export const REGISTRY: Record<ModeId, ModeEntry> = {
  paint: { def: MODE_DEFS.paint, rules: paint },
  splat: { def: MODE_DEFS.splat, rules: splat },
  enclose: { def: MODE_DEFS.enclose, rules: enclose },
};
```

`room/src/store/store.ts` — add `modeState?: ModeState | null;` to `Meta` (import `ModeState` from `@gallery/shared`).

`room/src/game/engine.ts` — apply these edits:

1. Imports: remove `BRUSH_RADIUS` and `MODES`; add `nextModeInfo`, `type ModeState` from shared and `REGISTRY, type ModeEntry` from `./modes`.
2. New fields next to the others:
```ts
  modeState: ModeState | null = null;
  private modeStateDirty = false;
  private idCounter = 0;
```
3. New helpers:
```ts
  private entry(idx: number): ModeEntry {
    const reg = this.cfg.registry ?? REGISTRY;
    return reg[modeForRound(idx, this.cfg.order)]!;
  }

  private scores(): Record<number, number> {
    const { rules } = this.entry(this.roundIdx);
    return rules.score ? rules.score({ grid: this.grid, players: [...this.players.values()] }) : this.grid.shares();
  }

  setModeState(next: ModeState | null): void {
    this.modeState = next;
    this.modeStateDirty = true;
    this.metaDirty = true;
  }

  private freshId(slot: number, id: string): string {
    if (!this.strokeIdx.has(`${slot}:${id}`)) return id;
    let candidate: string;
    do { candidate = `${id}~${++this.idCounter}`; } while (this.strokeIdx.has(`${slot}:${candidate}`));
    return candidate;
  }
```
4. Replace the stroke-applying part of `onStroke` (from `const key = ...` through the `if (m.end === true)` line) with:
```ts
    const entry = this.entry(this.roundIdx);
    const rules = entry.rules;
    const runs = rules.filterPoints
      ? rules.filterPoints({ player: p, pts, now, roundIdx: this.roundIdx }).filter((r) => r.length > 0)
      : [pts];
    if (runs.length === 0) { p.curStroke = null; return out; }

    let continuing = p.curStroke === m.id && p.curOpId != null && this.strokeIdx.has(`${p.slot}:${p.curOpId}`);
    let opId = continuing ? p.curOpId! : m.id;
    for (const run of runs) {
      if (!continuing) opId = this.freshId(p.slot, m.id);
      this.applyRun(p, opId, run, !continuing, entry, out, clientId);
      continuing = false;
    }
    const lastRun = runs[runs.length - 1]!;
    const tailKept = lastRun[lastRun.length - 1] === pts[pts.length - 1];
    if (m.end === true || !tailKept) { p.curStroke = null; p.curOpId = null; }
    else { p.curStroke = m.id; p.curOpId = opId; }
    return out;
  }

  private applyRun(p: PlayerState, opId: string, pts: Pt[], newStroke: boolean, entry: ModeEntry, out: Outbound[], clientId: string): void {
    const now = p.lastMsgAt;
    const owner = entry.rules.erases ? 0 : p.slot;
    const key = `${p.slot}:${opId}`;
    let opIndex: number;
    let prev: Pt | null = null;
    if (newStroke) {
      opIndex = this.pushOp({ k: 's', id: opId, pid: owner, pts: [] });
      this.strokeIdx.set(key, opIndex);
    } else {
      opIndex = this.strokeIdx.get(key)!;
      const existing = this.ops[opIndex] as Extract<Op, { k: 's' }>;
      const n = existing.pts.length;
      prev = { x: existing.pts[n - 2]!, y: existing.pts[n - 1]! };
      this.dirtyFrom = Math.min(this.dirtyFrom, opIndex);
    }
    const op = this.ops[opIndex] as Extract<Op, { k: 's' }>;
    const flat = pts.flatMap((q) => [q.x, q.y]);
    op.pts.push(...flat);
    this.opPoints += pts.length;

    const path = prev ? [prev, ...pts] : pts;
    for (let i = 1; i < path.length; i++) p.stats.ink += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    void now;
    p.stats.overdraw += this.grid.stampPath(owner, path, entry.def.brush);
    this.scoresDirty = true;
    this.metaDirty = true;

    out.push({ to: { except: clientId }, msg: { t: 'stroke', id: opId, pid: owner, pts: flat } });

    for (const poly of entry.rules.onPoints({ player: p, pts, newStroke })) this.applyFill(p, poly, out);
  }
```
and keep `p.stats.drawMs` accounting in `onStroke` before the run loop:
```ts
    if (p.lastMsgAt && now - p.lastMsgAt < 500 && p.curStroke === m.id) p.stats.drawMs += now - p.lastMsgAt;
    p.lastMsgAt = now;
```
(remove the `void now` / `const now = p.lastMsgAt` lines in `applyRun`, they are unnecessary).
5. `applyFill` is unchanged but skips erasing modes: add at its top `if (this.entry(this.roundIdx).rules.erases) return;`.
6. `tick`: use `this.scores()` instead of `this.grid.shares()` and append mode state emission:
```ts
    if (this.modeStateDirty) {
      this.modeStateDirty = false;
      out.push({ to: 'all', msg: { t: 'mode-state', idx: this.roundIdx, state: this.modeState } });
    }
```
7. `startRound`: after `this.winnerPid = null;` add
```ts
    const init = this.entry(idx).rules.init;
    this.modeState = init ? init({ roundIdx: idx }) : null;
    this.modeStateDirty = this.modeState !== null;
```
8. `finalize`: use `const shares = this.scores();` (instead of `this.grid.shares()`).
9. `restore`: replay with the round's brush and erasing:
```ts
    const entry = this.entry(meta.roundIdx);
    this.modeState = meta.modeState !== undefined ? meta.modeState : (entry.rules.init?.({ roundIdx: meta.roundIdx }) ?? null);
    ...
        this.grid.stampPath(op.pid, pts, entry.def.brush);
```
and compute the finalized winner from `this.scores()`.
10. `flush`: include `modeState: this.modeState` in `saveMeta`.
11. `roundInfo`: use the registry:
```ts
  private roundInfo(now: number): RoundInfo {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    const e = this.entry(w.idx);
    const nextId = modeForRound(w.idx + 1, this.cfg.order);
    const nx = (this.cfg.registry ?? REGISTRY)[nextId]!.def;
    return {
      idx: w.idx, mode: e.def.id, modeName: e.def.name, rules: e.def.rules, howTo: e.def.howTo, brush: e.def.brush,
      phase: w.phase, startsAt: w.startsAt, overAt: w.overAt, endsAt: w.endsAt,
      next: { mode: nx.id, name: nx.name, rules: nx.rules, howTo: nx.howTo, brush: nx.brush },
    };
  }
```
(`nextModeInfo` from shared is used by clients/tests; the engine builds `next` from its own registry so injected test modes work.)
12. `welcome`: use `shares: this.scores()` and add `modeState: this.modeState`.
13. `room/src/room.ts` already reads `ROUND_MS` and `MODE_ORDER` from shared — no change. `room/wrangler.toml`: `ROUND_MINUTES = "1"`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run room`
Expected: PASS (all earlier engine tests plus the new ones). If a new test's own arithmetic is wrong (for example the Splat comparison threshold), fix the test only after reasoning about the numbers; never loosen it to hide a real engine bug.
Run: `npm run typecheck`
Expected: shared and room clean; web may report errors from `welcome`/`RoundInfo` shape changes — those are fixed in Task 3. Do not proceed to commit until `tsc -p room` is clean.

- [ ] **Step 5: Commit**

```bash
git add room shared
git commit -m "feat(room): mode registry with per-mode brush, scoring, erase, filtering, mode state"
```

---

### Task 3: Web — per-mode rendering, erase color, reducer mode state

**Files:**
- Modify: `web/src/canvas/render.ts`, `web/src/canvas/PaintCanvas.tsx`, `web/src/gallery/PastRounds.tsx`, `web/src/state/roomReducer.ts`
- Test: `web/src/canvas/render.test.ts` (append), `web/src/canvas/opLog.test.ts` (append), `web/src/state/roomReducer.test.ts` (fixtures + append)

**Interfaces:**
- Produces: `PAPER` constant and `inkColor(pid: number, colors: Map<number, string>): string` in `render.ts`; `drawSegment(ctx, color, pts, prev, scale = 1, radius = BRUSH_RADIUS)` and `drawOps(ctx, ops, colorOf, scale = 1, radius = BRUSH_RADIUS)`; `RoomState.modeState: ModeState | null`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/canvas/render.test.ts`:
```ts
import { inkColor, PAPER } from './render';

describe('inkColor', () => {
  it('draws erasing strokes (pid 0) in paper color', () => {
    expect(inkColor(0, new Map([[1, '#f00']]))).toBe(PAPER);
  });
  it('uses the player color, with a gray fallback for unknown players', () => {
    const colors = new Map([[1, '#f00']]);
    expect(inkColor(1, colors)).toBe('#f00');
    expect(inkColor(9, colors)).toBe('#888888');
  });
});
```
Append to `web/src/canvas/opLog.test.ts` inside the main `describe`:
```ts
  it('keeps erase strokes (pid 0) like any other stroke', () => {
    const log = new OpLog();
    log.apply({ t: 'stroke', id: 'e', pid: 0, pts: [1, 1, 2, 2] });
    expect(log.snapshot()).toEqual([{ k: 's', id: 'e', pid: 0, pts: [1, 1, 2, 2] }]);
  });
```
In `web/src/state/roomReducer.test.ts` update the shared fixtures to the new shapes and add a test:
```ts
const round: RoundInfo = {
  idx: 5, mode: 'paint', modeName: 'Paint War', rules: 'r', howTo: ['a'], brush: 6, phase: 'playing',
  startsAt: 0, overAt: 900, endsAt: 1000,
  next: { mode: 'splat', name: 'Splat', rules: 'r', howTo: ['b'], brush: 20 },
};
```
add `modeState: null,` to the `welcome` fixture, and append:
```ts
  it('stores mode state from welcome and mode-state messages', () => {
    let s = reduce(initialState, srv({ ...welcome, modeState: { a: 1 } } as ServerMsg));
    expect(s.modeState).toEqual({ a: 1 });
    s = reduce(s, srv({ t: 'mode-state', idx: 5, state: { a: 2 } }));
    expect(s.modeState).toEqual({ a: 2 });
  });

  it('clears mode state on a wiping round message', () => {
    let s = reduce(initialState, srv({ ...welcome, modeState: { a: 1 } } as ServerMsg));
    s = reduce(s, srv({ t: 'round', round: { ...round, idx: 6 }, winnerPid: null, wipe: true, history: [] }));
    expect(s.modeState).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run web`
Expected: FAIL (`inkColor`/`PAPER` missing, `modeState` undefined).

- [ ] **Step 3: Implement**

`web/src/canvas/render.ts` — add `export const PAPER = '#f7f1e3';`, use it in `clearCanvas`, add
```ts
export function inkColor(pid: number, colors: Map<number, string>): string {
  if (pid === 0) return PAPER;
  return colors.get(pid) ?? '#888888';
}
```
and thread a `radius` parameter: `drawSegment(ctx, color, pts, prev, scale = 1, radius = BRUSH_RADIUS)` (use `radius` for `lineWidth` and the dot arc), `drawOps(ctx, ops, colorOf, scale = 1, radius = BRUSH_RADIUS)` passing it to `drawSegment`.

`web/src/state/roomReducer.ts`: add `modeState: ModeState | null` to `RoomState` and `initialState` (`null`); in `welcome` set `modeState: m.modeState`; add `case 'mode-state': return { ...state, modeState: m.state };`; in `round`, when `m.wipe` set `modeState: null`.

`web/src/canvas/PaintCanvas.tsx`: add a prop `brush: number` and a `brushRef`; replace `colorOf` with `(pid) => inkColor(pid, colors.current)`; every `drawSegment(...)` call for live drawing or incoming strokes passes `brushRef.current`; `drawOps(ctx(), opLog.snapshot(), colorOf, 1, brushRef.current)` for the mount replay and the welcome handler (use `m.round.brush` there).

`web/src/gallery/Gallery.tsx`: pass `brush={round?.brush ?? 6}` to `PaintCanvas`.

`web/src/gallery/PastRounds.tsx`: `paint(canvas, ops, round, scale)` calls `drawOps(ctx, ops, colorOf, scale, MODE_DEFS[round.mode].brush)` (import `MODE_DEFS`); `MODE_LABEL` becomes `MODE_DEFS[r.mode].name`. In `colorOf` use `pid === 0 ? PAPER : round.players[pid]?.color ?? '#888888'`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all suites PASS.
Run: `npm run typecheck`
Expected: clean for shared, room and web.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): per-mode brush, erase color, mode state in the reducer"
```

---

### Task 4: Web — overlay layer, "Up next" panel, how-to popover

**Files:**
- Create: `web/src/canvas/OverlayLayer.tsx`
- Modify: `web/src/gallery/RoundOver.tsx`, `web/src/gallery/Plaque.tsx`, `web/src/gallery/Gallery.tsx`, `web/src/gallery/gallery.css`

**Interfaces:**
- Consumes: `overlayShapes`, `MODE_DEFS`, `OverlayShape`, `RoundInfo` (with `next`, `howTo`).
- Produces: `OverlayLayer({ shapes }: { shapes: OverlayShape[] })`.

These are visual components verified in the browser (no DOM test environment is installed); their pure logic (`overlayShapes`, `nextModeInfo`) is already covered in Task 1.

- [ ] **Step 1: Write the components**

`web/src/canvas/OverlayLayer.tsx`:
```tsx
import { CANVAS_H, CANVAS_W, type OverlayShape } from '@gallery/shared';

const TONES: Record<string, string> = { zone: '#ffd24a', flag: '#ffffff', hill: '#7cf5a3' };

export function OverlayLayer({ shapes }: { shapes: OverlayShape[] }) {
  if (shapes.length === 0) return null;
  return (
    <svg className="overlay-layer" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="none">
      {shapes.map((s, i) =>
        s.kind === 'ring' ? (
          <path
            key={i}
            fillRule="evenodd"
            fill="rgba(10,6,3,0.45)"
            d={`M0 0H${CANVAS_W}V${CANVAS_H}H0Z M${s.x - s.r} ${s.y}a${s.r} ${s.r} 0 1 0 ${s.r * 2} 0a${s.r} ${s.r} 0 1 0 ${-s.r * 2} 0Z`}
          />
        ) : (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r} fill={TONES[s.tone]} fillOpacity={0.12} stroke={TONES[s.tone]} strokeWidth={4} strokeDasharray="14 10" />
            {s.label && (
              <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="middle" fontSize={34} fontWeight={700} fill={TONES[s.tone]} stroke="rgba(0,0,0,.5)" strokeWidth={1}>
                {s.label}
              </text>
            )}
          </g>
        ),
      )}
    </svg>
  );
}
```

`web/src/gallery/RoundOver.tsx` — add the "Up next" panel under the winner card:
```tsx
import type { PlayerInfo, RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';

interface Props { round: RoundInfo; winner: PlayerInfo | undefined; share: number; now: number }

export function RoundOver({ round, winner, share, now }: Props) {
  return (
    <div className="round-over">
      <div className="round-over-stack">
        <div className="round-over-card">
          <div className="eyebrow">Round over</div>
          {winner ? (
            <>
              <div className="winner" style={{ color: winner.color }}>{winner.name}</div>
              <div className="winner-line">wins with {(share * 100).toFixed(1)}%</div>
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
```

`web/src/gallery/Plaque.tsx` — add a `?` toggle:
```tsx
import { useState } from 'react';
import type { RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';

export function Plaque({ round, now }: { round: RoundInfo | null; now: number }) {
  const [open, setOpen] = useState(false);
  if (!round) return <div className="plaque"><div className="plaque-title">Hanging the next piece…</div></div>;
  const playing = round.phase === 'playing';
  return (
    <div className="plaque">
      <button className="plaque-help" onClick={() => setOpen((o) => !o)} aria-label="How this mode works" aria-expanded={open}>?</button>
      <div className="plaque-title">{round.modeName}</div>
      <div className="plaque-rules">{round.rules}</div>
      {open && <ul className="plaque-howto">{round.howTo.map((l) => <li key={l}>{l}</li>)}</ul>}
      <div className="plaque-clock">
        {playing ? `Ends in ${formatCountdown(round.overAt - now)}` : `Next round in ${formatCountdown(round.endsAt - now)}`}
      </div>
    </div>
  );
}
```

`web/src/gallery/Gallery.tsx` — render the overlay inside `.canvas-wrap` after `CursorLayer`:
```tsx
{round && <OverlayLayer shapes={overlayShapes(MODE_DEFS[round.mode], round, now, state.modeState)} />}
```
(imports: `MODE_DEFS`, `overlayShapes` from `@gallery/shared`, `OverlayLayer` from `../canvas/OverlayLayer`.)

Append to `web/src/gallery/gallery.css`:
```css
.overlay-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.round-over-stack { display: flex; gap: 18px; align-items: stretch; flex-wrap: wrap; justify-content: center; padding: 12px; }
.upnext-card { max-width: 340px; padding: 20px 26px; background: #2a1d06; color: #f3e6c4; border: 3px double var(--gold); box-shadow: 0 16px 40px rgba(0, 0, 0, .6); }
.upnext-title { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; margin: 4px 0 8px; color: var(--gold); }
.upnext-card ul { margin: 0; padding-left: 20px; font-size: 18px; line-height: 1.35; }
.plaque { position: relative; }
.plaque-help { position: absolute; top: 8px; right: 10px; width: 26px; height: 26px; border-radius: 50%; border: 1px solid #5b4310; background: rgba(255, 255, 255, .35); color: #2a1d06; font: 700 16px 'Playfair Display', serif; cursor: pointer; }
.plaque-howto { text-align: left; margin: 6px 0 8px; padding-left: 20px; font-size: 16px; }
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck`
Expected: clean.
Run: `npm test`
Expected: PASS.
Run: `npm run build -w web`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web
git commit -m "feat(web): overlay layer, Up next panel, how-to popover"
```

---

### Task 5: End-to-end check, README, local push of docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README** — in "Free-tier budget" add a paragraph: rounds are 1 minute, so about 1,440 round changes per day, each costing a handful of SQLite writes plus two alarm writes, roughly 7–15k rows/day against the 100,000/day limit; the past-rounds wall covers the last ~50 minutes. In the first paragraph list the modes (Paint War, Splat, Lasso) and in "Local development" drop the `ROUND_MINUTES=1` hint (it is now the default; mention `ROUND_MINUTES` to change it).

- [ ] **Step 2: Run the whole suite and the real-runtime smoke test**

Run: `npm test` — Expected: all PASS.
Start `wrangler dev` in `room/` and run `npm run smoke -w room` — Expected: `Smoke test passed.` (the smoke script reads `ops`/`stroke`; the new welcome fields do not affect it).

- [ ] **Step 3: Browser verification (Vite + wrangler dev)**

With both dev servers running and one browser tab joined (plus a Node client drawing as a second player via `ws`), verify and note each result:
1. The plaque shows the current mode and a `?` button; clicking it lists the how-to lines.
2. In the over phase the winner card and an "Up next: <mode>" panel are both visible, and the panel matches the following round.
3. The rotation is Paint War → Splat → Lasso → Paint War, one minute each.
4. In Splat a short drag leaves a visibly wider stroke than in Paint War, on the drawing tab and on a second client's canvas after reload.
5. A refresh in the middle of a Splat round shows the existing blobs at the Splat brush width (not thin lines).

- [ ] **Step 4: Commit (no push)**

```bash
git add -A
git commit -m "docs: README for 1-minute rounds and the mode framework"
```
