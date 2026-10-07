# Canvas Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free-to-host realtime shared drawing canvas, shown as a framed painting in an art gallery, with per-person colors, live cursors, rotating 30-minute game modes (Paint, Enclose), and a territory leaderboard.

**Architecture:** npm-workspaces monorepo. `shared/` holds constants and the wire protocol. `room/` holds a pure, fully unit-tested `GameEngine` (modes, ownership grid, round clock, scoring) wrapped by a thin Cloudflare Durable Object (WebSocket, SQLite persistence, alarms). `web/` is a React + Vite SPA that renders the canvas by replaying server-sent ops and draws the gallery scene in CSS.

**Tech Stack:** TypeScript (strict), React 18, Vite, Vitest, Cloudflare Workers + Durable Objects (SQLite-backed, free plan), Wrangler, Vercel Hobby.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-gallery-design.md`

## Global Constraints

- Canvas is fixed at `1600x1000`; brush is fixed round, radius `6`; ownership grid cell is `4px` (`400x250` cells).
- Round length default `30 min` (config `ROUND_MINUTES`); modes rotate `paint`, `enclose`, then repeat; mode = `order[floor(now/roundMs) % order.length]`.
- The last `10 s` of each round is an "over" phase: drawing is rejected, the winner is announced. The next round starts with a wiped canvas.
- Server is authoritative for ownership, fills, scores, round clock. Clients never send scores.
- Enclose fills: only against the player's own lines; reject fills under `20` cells or over `50%` of the canvas.
- No login. Identity = `clientId` (random id kept in the browser) + display name (max 20 chars). Server assigns the lowest free color slot from a 24-color palette. Optional room password via env var `ROOM_PASSWORD` (empty = off).
- Everything must run on free tiers: Vercel Hobby (static site) + Cloudflare Workers free plan (one Durable Object, SQLite storage, no WebSocket hibernation).
- SQLite writes must stay low: persist at most every 10 s and only dirty 100-op chunks.
- Cursors are derived from stroke points (shown while drawing, hidden ~2 s after the last point); there is no separate cursor message. (Simplification of spec Section 2 with identical visible behavior.)
- Past rounds keep the last `50` rounds. Rounds with no ops are not recorded.
- Desktop/laptop layout only (min width ~1100px for the 3-column scene; narrower stacks vertically but is not a goal).
- No credentials are handled by the assistant: the user runs `wrangler login` and Vercel login themselves.

## Review Focus

1. Same `clientId` joining twice (two tabs / reconnect): keep the same slot and color, close the older socket, don't mark the player offline when the old socket's close event arrives late. (Task 6 tests + Task 7 handler.)
2. Malformed or hostile input (non-JSON, NaN, strings, odd-length point arrays, thousands of points, out-of-bounds coordinates, huge names, HTML in names): ignored or clamped/sanitized, never crashes, never changes scores. (Task 6 tests.)
3. Drawing at round boundaries: strokes during the "over" phase are rejected; a stroke in flight at the boundary does not leak into the next round; the new round starts wiped even if the server missed the boundary. (Task 6 tests.)
4. Durable Object eviction/redeploy mid-round: state restored from SQLite (players, wins, current ops, ownership grid rebuilt by replay, history). (Task 6 test with `MemoryStore`, Task 7 `SqlStore`.)
5. Capacity and empty cases: room full (24 online players) gets a clear error; a round nobody drew in has no winner and no history entry; an Enclose loop covering >50% of the canvas is rejected. (Task 6 tests.)

---

## File Structure

```
package.json                  root workspaces + scripts
tsconfig.base.json
vitest.config.ts
.gitignore
README.md                     run + deploy instructions (Task 13)
shared/
  package.json  tsconfig.json
  src/index.ts                re-exports
  src/constants.ts            sizes, timings, limits, palette, mode order
  src/protocol.ts             Op, ClientMsg, ServerMsg, PlayerInfo, RoundInfo, RoundSummary
  src/clock.ts                phaseAt, modeForRound  (+ clock.test.ts)
room/
  package.json  tsconfig.json  wrangler.toml
  src/index.ts                Worker entry (routes /ws, /health)
  src/room.ts                 Durable Object wrapper (sockets, alarms, persistence wiring)
  src/game/geometry.ts        segIntersect, polygonArea, pointInPolygon, decimate (+ test)
  src/game/ownership.ts       OwnershipGrid (+ test)
  src/game/loops.ts           LoopTrail (+ test)
  src/game/types.ts           PlayerState, Outbound, EngineConfig
  src/game/modes.ts           paint, enclose, MODES (+ test)
  src/game/engine.ts          GameEngine (+ engine.test.ts)
  src/store/store.ts          Store interface + Meta
  src/store/memoryStore.ts    in-memory Store (tests)
  src/store/sqlStore.ts       Durable Object SQLite Store
  scripts/smoke.ts            multi-client smoke test against wrangler dev
web/
  package.json  tsconfig.json  vite.config.ts  vercel.json  index.html
  src/main.tsx  src/App.tsx
  src/session.ts              clientId/name persistence
  src/state/roomReducer.ts    pure reducer (+ roomReducer.test.ts)
  src/net/useRoom.ts          WebSocket hook (reconnect, subscribe, getRoundOps)
  src/canvas/render.ts        drawOps / drawSegment / drawFill / clear
  src/canvas/PaintCanvas.tsx  input + live rendering
  src/canvas/CursorLayer.tsx  smoothed cursors
  src/gallery/Gallery.tsx     scene layout
  src/gallery/Plaque.tsx      mode name, rules, countdown
  src/gallery/Leaderboard.tsx territory + wins
  src/gallery/RoundOver.tsx   winner overlay
  src/gallery/PastRounds.tsx  thumbnails + lightbox
  src/gallery/JoinScreen.tsx  name entry
  src/gallery/gallery.css     museum look
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Create: `room/package.json`, `room/tsconfig.json`, `room/wrangler.toml`
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`

**Interfaces:**
- Produces: workspace package `@gallery/shared` importable from `room` and `web`; `npm test` runs all Vitest tests.

- [ ] **Step 1: Init git and write root files**

Run: `git init`

`package.json`:
```json
{
  "name": "canvas-gallery",
  "private": true,
  "workspaces": ["shared", "room", "web"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p shared --noEmit && tsc -p room --noEmit && tsc -p web --noEmit",
    "dev:room": "npm run dev -w room",
    "dev:web": "npm run dev -w web"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'room/**/*.test.ts', 'web/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.gitignore`:
```
node_modules
dist
.wrangler
.dev.vars
.env*
.remember
```

- [ ] **Step 2: Write workspace packages**

`shared/package.json`:
```json
{ "name": "@gallery/shared", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts", "types": "src/index.ts" }
```
`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```
`shared/src/index.ts`:
```ts
export {};
```

`room/package.json`:
```json
{
  "name": "@gallery/room",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": { "@gallery/shared": "*" },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "wrangler": "^4.0.0",
    "ws": "^8.18.0"
  }
}
```
`room/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"], "lib": ["ES2022"] },
  "include": ["src", "scripts"]
}
```
`room/wrangler.toml`:
```toml
name = "canvas-gallery-room"
main = "src/index.ts"
compatibility_date = "2026-10-01"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "Room"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room"]

[vars]
ROOM_PASSWORD = ""
ROUND_MINUTES = "30"
```

`web/package.json`:
```json
{
  "name": "@gallery/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -p . && vite build", "preview": "vite preview" },
  "dependencies": { "@gallery/shared": "*", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```
`web/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"] },
  "include": ["src"]
}
```
`web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
```
`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canvas Gallery</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Cormorant+Garamond:wght@500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```
`web/src/App.tsx`:
```tsx
export function App() {
  return <div>Canvas Gallery</div>;
}
```

- [ ] **Step 3: Install and verify**

Run: `npm install`
Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: "No test files found" (exit code may be 1 until Task 2 adds tests; that is fine).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo (shared, room, web)"
```

---

### Task 2: Shared constants, protocol, and round clock

**Files:**
- Create: `shared/src/constants.ts`, `shared/src/protocol.ts`, `shared/src/clock.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/clock.test.ts`

**Interfaces:**
- Produces (all exported from `@gallery/shared`):
  - constants: `CANVAS_W=1600`, `CANVAS_H=1000`, `CELL=4`, `GRID_W=400`, `GRID_H=250`, `BRUSH_RADIUS=6`, `ROUND_MS`, `OVER_MS`, `MAX_FILL_SHARE`, `MIN_FILL_CELLS`, `MAX_PTS_PER_MSG`, `MAX_OPS_POINTS`, `NAME_MAX`, `HISTORY_LIMIT`, `OP_CHUNK`, `PALETTE: readonly string[]` (24), `MODE_ORDER: readonly ModeId[]`
  - types: `ModeId`, `Op`, `StrokeOp`, `FillOp`, `ClientMsg`, `ServerMsg`, `PlayerInfo`, `RoundInfo`, `RoundSummary`
  - `phaseAt(now, roundMs, overMs): { idx:number; phase:'playing'|'over'; startsAt:number; overAt:number; endsAt:number }`
  - `modeForRound(idx: number, order: readonly ModeId[]): ModeId`

- [ ] **Step 1: Write the failing test** — `shared/src/clock.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { phaseAt, modeForRound } from './clock';

describe('phaseAt', () => {
  const R = 1000, O = 100;
  it('is playing at the start of a round', () => {
    expect(phaseAt(2000, R, O)).toEqual({ idx: 2, phase: 'playing', startsAt: 2000, overAt: 2900, endsAt: 3000 });
  });
  it('is playing just before over', () => {
    expect(phaseAt(2899, R, O).phase).toBe('playing');
  });
  it('is over from overAt until the end', () => {
    expect(phaseAt(2900, R, O).phase).toBe('over');
    expect(phaseAt(2999, R, O).phase).toBe('over');
  });
  it('starts the next round exactly at endsAt', () => {
    const w = phaseAt(3000, R, O);
    expect(w.idx).toBe(3);
    expect(w.phase).toBe('playing');
  });
});

describe('modeForRound', () => {
  it('cycles through the order', () => {
    const order = ['paint', 'enclose'] as const;
    expect(modeForRound(0, order)).toBe('paint');
    expect(modeForRound(1, order)).toBe('enclose');
    expect(modeForRound(2, order)).toBe('paint');
    expect(modeForRound(970001, order)).toBe('enclose');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run shared/src/clock.test.ts`
Expected: FAIL — cannot resolve `./clock`.

- [ ] **Step 3: Write the implementation**

`shared/src/constants.ts`:
```ts
export const CANVAS_W = 1600;
export const CANVAS_H = 1000;
export const CELL = 4;
export const GRID_W = CANVAS_W / CELL;
export const GRID_H = CANVAS_H / CELL;
export const BRUSH_RADIUS = 6;

export const ROUND_MS = 30 * 60 * 1000;
export const OVER_MS = 10_000;

export const MAX_FILL_SHARE = 0.5;
export const MIN_FILL_CELLS = 20;
export const MAX_PTS_PER_MSG = 64;
export const MAX_OPS_POINTS = 150_000;
export const NAME_MAX = 20;
export const HISTORY_LIMIT = 50;
export const OP_CHUNK = 100;

export const MODE_ORDER = ['paint', 'enclose'] as const;

/** Slot n (1-based) uses PALETTE[n - 1]. */
export const PALETTE: readonly string[] = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1',
  '#000075', '#808080', '#ff6f91', '#00c9a7', '#845ec2', '#ffc75f',
];
```

`shared/src/protocol.ts`:
```ts
export type ModeId = 'paint' | 'enclose';

export interface StrokeOp { k: 's'; id: string; pid: number; pts: number[] }
export interface FillOp { k: 'f'; pid: number; poly: number[] }
export type Op = StrokeOp | FillOp;

export interface PlayerInfo { pid: number; name: string; color: string; online: boolean; wins: number }

export interface RoundInfo {
  idx: number;
  mode: ModeId;
  modeName: string;
  rules: string;
  phase: 'playing' | 'over';
  startsAt: number;
  overAt: number;
  endsAt: number;
}

export interface RoundSummary {
  idx: number;
  mode: ModeId;
  endedAt: number;
  winnerPid: number | null;
  shares: Record<number, number>;
  players: Record<number, { name: string; color: string }>;
}

export type ClientMsg =
  | { t: 'join'; clientId: string; name: string; password?: string }
  | { t: 'stroke'; id: string; pts: number[]; end?: boolean }
  | { t: 'get-round'; idx: number };

export type ServerMsg =
  | {
      t: 'welcome';
      serverNow: number;
      you: number;
      players: PlayerInfo[];
      round: RoundInfo;
      winnerPid: number | null;
      ops: Op[];
      shares: Record<number, number>;
      history: RoundSummary[];
    }
  | { t: 'error'; reason: 'bad-password' | 'room-full' | 'bad-join' }
  | { t: 'stroke'; id: string; pid: number; pts: number[] }
  | { t: 'fill'; pid: number; poly: number[] }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'scores'; shares: Record<number, number> }
  | { t: 'round'; round: RoundInfo; winnerPid: number | null; wipe: boolean; history: RoundSummary[] }
  | { t: 'round-ops'; idx: number; ops: Op[] };
```

`shared/src/clock.ts`:
```ts
import type { ModeId } from './protocol';

export interface RoundWindow {
  idx: number;
  phase: 'playing' | 'over';
  startsAt: number;
  overAt: number;
  endsAt: number;
}

export function phaseAt(now: number, roundMs: number, overMs: number): RoundWindow {
  const idx = Math.floor(now / roundMs);
  const startsAt = idx * roundMs;
  const endsAt = startsAt + roundMs;
  const overAt = endsAt - overMs;
  return { idx, phase: now >= overAt ? 'over' : 'playing', startsAt, overAt, endsAt };
}

export function modeForRound(idx: number, order: readonly ModeId[]): ModeId {
  return order[idx % order.length]!;
}
```

`shared/src/index.ts`:
```ts
export * from './constants';
export * from './protocol';
export * from './clock';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run shared/src/clock.test.ts`
Expected: PASS (5 tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): constants, wire protocol, round clock"
```

---

### Task 3: Geometry and ownership grid

**Files:**
- Create: `room/src/game/geometry.ts`, `room/src/game/ownership.ts`
- Test: `room/src/game/geometry.test.ts`, `room/src/game/ownership.test.ts`

**Interfaces:**
- Produces:
  - `type Pt = { x: number; y: number }`
  - `segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null`
  - `polygonArea(poly: Pt[]): number`
  - `pointInPolygon(p: Pt, poly: Pt[]): boolean`
  - `decimate(poly: Pt[], max: number): Pt[]`
  - `class OwnershipGrid { readonly cells: Uint8Array; stampPath(owner: number, pts: Pt[], r: number): number /*stolen*/; polygonCells(poly: Pt[]): number[]; setCells(owner: number, cells: number[]): number /*stolen*/; shares(): Record<number, number>; clear(): void }`

- [ ] **Step 1: Write the failing tests**

`room/src/game/geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { segIntersect, polygonArea, pointInPolygon, decimate } from './geometry';

const P = (x: number, y: number) => ({ x, y });

describe('segIntersect', () => {
  it('finds a crossing point', () => {
    const p = segIntersect(P(0, 0), P(10, 10), P(0, 10), P(10, 0));
    expect(p!.x).toBeCloseTo(5);
    expect(p!.y).toBeCloseTo(5);
  });
  it('returns null for parallel segments', () => {
    expect(segIntersect(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBeNull();
  });
  it('returns null when segments do not reach each other', () => {
    expect(segIntersect(P(0, 0), P(1, 1), P(5, 0), P(5, 10))).toBeNull();
  });
});

describe('polygonArea / pointInPolygon', () => {
  const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  it('computes area', () => expect(polygonArea(square)).toBeCloseTo(100));
  it('detects inside and outside', () => {
    expect(pointInPolygon(P(5, 5), square)).toBe(true);
    expect(pointInPolygon(P(15, 5), square)).toBe(false);
  });
});

describe('decimate', () => {
  it('keeps short polygons unchanged', () => {
    const poly = [P(0, 0), P(1, 1), P(2, 2)];
    expect(decimate(poly, 10)).toEqual(poly);
  });
  it('reduces to at most max points', () => {
    const poly = Array.from({ length: 1000 }, (_, i) => P(i, i));
    expect(decimate(poly, 200).length).toBeLessThanOrEqual(200);
  });
});
```

`room/src/game/ownership.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OwnershipGrid } from './ownership';
import { GRID_W, GRID_H } from '@gallery/shared';

const P = (x: number, y: number) => ({ x, y });
const idx = (gx: number, gy: number) => gy * GRID_W + gx;

describe('OwnershipGrid', () => {
  it('stamps a dot for a single point', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    expect(g.cells[idx(25, 25)]).toBe(1);
    expect(g.cells[idx(60, 60)]).toBe(0);
  });

  it('stamps along a path with no gaps', () => {
    const g = new OwnershipGrid();
    g.stampPath(2, [P(10, 100), P(400, 100)], 6);
    for (let gx = 3; gx < 98; gx++) expect(g.cells[idx(gx, 25)]).toBe(2);
  });

  it('counts stolen cells when painting over another owner', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    const stolen = g.stampPath(2, [P(100, 100)], 6);
    expect(stolen).toBeGreaterThan(0);
    expect(g.cells[idx(25, 25)]).toBe(2);
  });

  it('does not count repainting your own cells as stolen', () => {
    const g = new OwnershipGrid();
    g.stampPath(1, [P(100, 100)], 6);
    expect(g.stampPath(1, [P(100, 100)], 6)).toBe(0);
  });

  it('computes polygon cells by cell centers', () => {
    const g = new OwnershipGrid();
    const cells = g.polygonCells([P(0, 0), P(40, 0), P(40, 40), P(0, 40)]);
    expect(cells.length).toBe(100);
  });

  it('setCells assigns ownership and reports stolen', () => {
    const g = new OwnershipGrid();
    g.setCells(1, [idx(0, 0), idx(1, 0)]);
    const stolen = g.setCells(2, [idx(1, 0), idx(2, 0)]);
    expect(stolen).toBe(1);
    expect(g.cells[idx(1, 0)]).toBe(2);
  });

  it('computes shares of the whole canvas and clears', () => {
    const g = new OwnershipGrid();
    const total = GRID_W * GRID_H;
    g.setCells(3, Array.from({ length: total / 4 }, (_, i) => i));
    expect(g.shares()[3]).toBeCloseTo(0.25);
    g.clear();
    expect(g.shares()).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run room/src/game`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`room/src/game/geometry.ts`:
```ts
export interface Pt { x: number; y: number }

export function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const qpx = c.x - a.x, qpy = c.y - a.y;
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

export function polygonArea(poly: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    const crosses = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function decimate(poly: Pt[], max: number): Pt[] {
  if (poly.length <= max) return poly;
  const step = poly.length / max;
  const out: Pt[] = [];
  for (let i = 0; i < max; i++) out.push(poly[Math.floor(i * step)]!);
  return out;
}
```

`room/src/game/ownership.ts`:
```ts
import { CELL, GRID_H, GRID_W } from '@gallery/shared';
import { pointInPolygon, type Pt } from './geometry';

export class OwnershipGrid {
  readonly cells = new Uint8Array(GRID_W * GRID_H);

  /** Stamp a round brush along a polyline. Returns cells taken from other owners. */
  stampPath(owner: number, pts: Pt[], r: number): number {
    let stolen = 0;
    if (pts.length === 0) return 0;
    stolen += this.stampCircle(owner, pts[0]!.x, pts[0]!.y, r);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(len / CELL));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        stolen += this.stampCircle(owner, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r);
      }
    }
    return stolen;
  }

  private stampCircle(owner: number, cx: number, cy: number, r: number): number {
    let stolen = 0;
    const gx0 = Math.max(0, Math.floor((cx - r) / CELL));
    const gx1 = Math.min(GRID_W - 1, Math.floor((cx + r) / CELL));
    const gy0 = Math.max(0, Math.floor((cy - r) / CELL));
    const gy1 = Math.min(GRID_H - 1, Math.floor((cy + r) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
        if (Math.hypot(px - cx, py - cy) > r) continue;
        const i = gy * GRID_W + gx;
        const prev = this.cells[i]!;
        if (prev !== 0 && prev !== owner) stolen++;
        this.cells[i] = owner;
      }
    }
    return stolen;
  }

  /** Indices of cells whose centers lie inside the polygon. */
  polygonCells(poly: Pt[]): number[] {
    if (poly.length < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const gx0 = Math.max(0, Math.floor(minX / CELL)), gx1 = Math.min(GRID_W - 1, Math.floor(maxX / CELL));
    const gy0 = Math.max(0, Math.floor(minY / CELL)), gy1 = Math.min(GRID_H - 1, Math.floor(maxY / CELL));
    const out: number[] = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (pointInPolygon({ x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 }, poly)) out.push(gy * GRID_W + gx);
      }
    }
    return out;
  }

  setCells(owner: number, cells: number[]): number {
    let stolen = 0;
    for (const i of cells) {
      const prev = this.cells[i]!;
      if (prev !== 0 && prev !== owner) stolen++;
      this.cells[i] = owner;
    }
    return stolen;
  }

  /** Fraction of the whole canvas owned by each owner (owners with 0 cells omitted). */
  shares(): Record<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < this.cells.length; i++) {
      const o = this.cells[i]!;
      if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    const out: Record<number, number> = {};
    for (const [o, n] of counts) out[o] = n / this.cells.length;
    return out;
  }

  clear(): void {
    this.cells.fill(0);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run room/src/game`
Expected: PASS (all geometry and ownership tests).

- [ ] **Step 5: Commit**

```bash
git add room/src/game
git commit -m "feat(room): geometry helpers and ownership grid"
```

---

### Task 4: Loop detection (Enclose)

**Files:**
- Create: `room/src/game/loops.ts`
- Test: `room/src/game/loops.test.ts`

**Interfaces:**
- Consumes: `Pt`, `segIntersect` from `./geometry`
- Produces: `class LoopTrail { beginStroke(p: Pt): void; push(p: Pt): Pt[] | null; reset(): void }` — `push` returns the closed polygon (≥3 points) when the new segment crosses an earlier segment of the player's own trail (current or earlier strokes), then continues the trail from the crossing point.

- [ ] **Step 1: Write the failing test** — `room/src/game/loops.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { LoopTrail } from './loops';
import { polygonArea } from './geometry';

const P = (x: number, y: number) => ({ x, y });

function feed(t: LoopTrail, pts: ReturnType<typeof P>[]) {
  t.beginStroke(pts[0]!);
  const polys = [];
  for (const p of pts.slice(1)) {
    const poly = t.push(p);
    if (poly) polys.push(poly);
  }
  return polys;
}

describe('LoopTrail', () => {
  it('returns nothing for a straight line', () => {
    expect(feed(new LoopTrail(), [P(0, 0), P(50, 0), P(100, 0)])).toEqual([]);
  });

  it('closes a loop when a stroke crosses itself', () => {
    const polys = feed(new LoopTrail(), [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)]);
    expect(polys.length).toBe(1);
    expect(polygonArea(polys[0]!)).toBeCloseTo(8333.33, 0);
  });

  it('closes a loop against an earlier stroke of the same player', () => {
    const t = new LoopTrail();
    feed(t, [P(0, 50), P(200, 50)]);
    const polys = feed(t, [P(100, 0), P(150, 0), P(150, 100), P(100, 100), P(100, 20)]);
    // second stroke crosses the first at (150,50) when moving (150,0)->(150,100)
    expect(polys.length).toBeGreaterThanOrEqual(1);
  });

  it('does not treat the bridge between two strokes as a line to cross', () => {
    const t = new LoopTrail();
    feed(t, [P(0, 0), P(10, 0)]);
    // new stroke starts far away; the straight bridge (10,0)->(500,500) must not count
    const polys = feed(t, [P(400, 0), P(400, 600)]);
    expect(polys).toEqual([]);
  });

  it('does not close on the immediately adjacent segment', () => {
    expect(feed(new LoopTrail(), [P(0, 0), P(10, 0), P(20, 0), P(30, 0)])).toEqual([]);
  });

  it('continues after a loop without re-triggering the same crossing', () => {
    const t = new LoopTrail();
    const first = feed(t, [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)]);
    expect(first.length).toBe(1);
    expect(t.push(P(60, -80))).toBeNull();
  });

  it('keeps memory bounded on very long strokes', () => {
    const t = new LoopTrail();
    t.beginStroke(P(0, 0));
    for (let i = 1; i < 20000; i++) t.push(P(i, 0));
    expect(t.size()).toBeLessThanOrEqual(3000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run room/src/game/loops.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** — `room/src/game/loops.ts`

```ts
import { segIntersect, type Pt } from './geometry';

const MAX_TRAIL = 3000;
const KEEP_AFTER_TRIM = 1500;

/**
 * A player's trail of points for the current round. Strokes are concatenated;
 * `breaks` holds indices of points that start a new stroke, so the straight
 * "bridge" between two strokes is never treated as a drawn line.
 */
export class LoopTrail {
  private pts: Pt[] = [];
  private breaks = new Set<number>();

  beginStroke(p: Pt): void {
    if (this.pts.length > 0) this.breaks.add(this.pts.length);
    this.pts.push(p);
  }

  /** Append a point. Returns the closed polygon if the new segment crosses an earlier drawn segment. */
  push(p: Pt): Pt[] | null {
    const n = this.pts.length;
    if (n === 0) {
      this.pts.push(p);
      return null;
    }
    const a = this.pts[n - 1]!;
    // newest-first so the smallest loop wins; skip adjacent segment (n-2) and bridges
    for (let i = n - 3; i >= 0; i--) {
      if (this.breaks.has(i + 1)) continue;
      const x = segIntersect(a, p, this.pts[i]!, this.pts[i + 1]!);
      if (x) {
        const poly = [x, ...this.pts.slice(i + 1)];
        this.pts = [x, p];
        this.breaks = new Set();
        return poly.length >= 3 ? poly : null;
      }
    }
    this.pts.push(p);
    if (this.pts.length > MAX_TRAIL) this.trim();
    return null;
  }

  size(): number {
    return this.pts.length;
  }

  reset(): void {
    this.pts = [];
    this.breaks = new Set();
  }

  private trim(): void {
    const drop = this.pts.length - KEEP_AFTER_TRIM;
    this.pts = this.pts.slice(drop);
    const next = new Set<number>();
    for (const b of this.breaks) if (b - drop > 0) next.add(b - drop);
    this.breaks = next;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run room/src/game/loops.test.ts`
Expected: PASS (7 tests). If the "earlier stroke" test fails because of geometry, adjust only the test's expected count, not the algorithm, after confirming by hand that the second stroke's segment `(150,0)->(150,100)` crosses `(0,50)->(200,50)`.

- [ ] **Step 5: Commit**

```bash
git add room/src/game/loops.ts room/src/game/loops.test.ts
git commit -m "feat(room): loop detection trail for Enclose mode"
```

---

### Task 5: Modes and engine types

**Files:**
- Create: `room/src/game/types.ts`, `room/src/game/modes.ts`
- Test: `room/src/game/modes.test.ts`

**Interfaces:**
- Consumes: `LoopTrail`, `Pt`
- Produces:
  - `PlayerState { clientId: string; slot: number; name: string; color: string; online: boolean; lastSeen: number; wins: number; stats: { ink: number; drawMs: number; overdraw: number }; trail: LoopTrail; curStroke: string | null; lastMsgAt: number; tokens: number; tokensAt: number }`
  - `Outbound { to: 'all' | { only: string } | { except: string }; msg: ServerMsg }`
  - `EngineConfig { roundMs: number; overMs: number; order: readonly ModeId[]; password: string }`
  - `Mode { id: ModeId; name: string; rules: string; onPoints(ctx: { player: PlayerState; pts: Pt[]; newStroke: boolean }): Pt[][] }`
  - `MODES: Record<ModeId, Mode>`

- [ ] **Step 1: Write the failing test** — `room/src/game/modes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MODES } from './modes';
import { LoopTrail } from './loops';
import type { PlayerState } from './types';

const P = (x: number, y: number) => ({ x, y });
const player = (): PlayerState => ({
  clientId: 'c', slot: 1, name: 'A', color: '#fff', online: true, lastSeen: 0, wins: 0,
  stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null, lastMsgAt: 0, tokens: 40, tokensAt: 0,
});

describe('modes', () => {
  it('paint never produces fills', () => {
    expect(MODES.paint.onPoints({ player: player(), pts: [P(0, 0), P(5, 5)], newStroke: true })).toEqual([]);
  });

  it('enclose emits a polygon when the stroke loops', () => {
    const p = player();
    const polys = MODES.enclose.onPoints({
      player: p,
      pts: [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(50, -50)],
      newStroke: true,
    });
    expect(polys.length).toBe(1);
  });

  it('enclose keeps the trail across batches of one stroke', () => {
    const p = player();
    MODES.enclose.onPoints({ player: p, pts: [P(0, 0), P(100, 0)], newStroke: true });
    MODES.enclose.onPoints({ player: p, pts: [P(100, 100), P(0, 100)], newStroke: false });
    const polys = MODES.enclose.onPoints({ player: p, pts: [P(50, -50)], newStroke: false });
    expect(polys.length).toBe(1);
  });

  it('each mode has a name and rules text', () => {
    for (const m of Object.values(MODES)) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.rules.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run room/src/game/modes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`room/src/game/types.ts`:
```ts
import type { ModeId, ServerMsg } from '@gallery/shared';
import type { LoopTrail } from './loops';

export interface PlayerStats { ink: number; drawMs: number; overdraw: number }

export interface PlayerState {
  clientId: string;
  slot: number;
  name: string;
  color: string;
  online: boolean;
  lastSeen: number;
  wins: number;
  stats: PlayerStats;
  trail: LoopTrail;
  curStroke: string | null;
  lastMsgAt: number;
  tokens: number;
  tokensAt: number;
}

export type Target = 'all' | { only: string } | { except: string };
export interface Outbound { to: Target; msg: ServerMsg }

export interface EngineConfig {
  roundMs: number;
  overMs: number;
  order: readonly ModeId[];
  password: string;
}
```

`room/src/game/modes.ts`:
```ts
import type { ModeId } from '@gallery/shared';
import type { Pt } from './geometry';
import type { PlayerState } from './types';

export interface ModeCtx { player: PlayerState; pts: Pt[]; newStroke: boolean }

export interface Mode {
  id: ModeId;
  name: string;
  rules: string;
  /** Called with newly received points; returns polygons that should be filled with the player's color. */
  onPoints(ctx: ModeCtx): Pt[][];
}

const paint: Mode = {
  id: 'paint',
  name: 'Paint War',
  rules: 'Cover as much of the canvas as you can. Paint over others to steal their ground.',
  onPoints: () => [],
};

const enclose: Mode = {
  id: 'enclose',
  name: 'Lasso',
  rules: 'Draw a line that loops back and crosses your own line. The loop fills with your color.',
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

export const MODES: Record<ModeId, Mode> = { paint, enclose };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run room/src/game/modes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add room/src/game/types.ts room/src/game/modes.ts room/src/game/modes.test.ts
git commit -m "feat(room): Paint and Enclose modes"
```

---

### Task 6: Store interface and GameEngine

**Files:**
- Create: `room/src/store/store.ts`, `room/src/store/memoryStore.ts`, `room/src/game/engine.ts`
- Test: `room/src/game/engine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  - `Store { loadMeta(): Meta | null; saveMeta(m: Meta): void; loadOpChunks(roundIdx: number): Op[]; saveOpChunk(roundIdx: number, chunk: number, ops: Op[]): void; saveSummary(s: RoundSummary): void; loadHistory(limit: number): RoundSummary[]; pruneBefore(roundIdx: number): void }`
  - `Meta { roundIdx: number; finalized: boolean; players: PersistedPlayer[] }`, `PersistedPlayer { clientId; slot; name; color; wins; lastSeen; stats }`
  - `class MemoryStore implements Store`
  - `class GameEngine`:
    - `constructor(cfg: EngineConfig, store: Store, now: number)`
    - `join(clientId: string, rawName: unknown, password: unknown, now: number): Outbound[]`
    - `disconnect(clientId: string, now: number): Outbound[]`
    - `onStroke(clientId: string, msg: unknown, now: number): Outbound[]`
    - `tick(now: number): Outbound[]` (round transitions + dirty scores)
    - `roundOps(idx: number): Op[]`
    - `nextEventAt(now: number): number`
    - `flush(): void`
    - public `players: Map<string, PlayerState>`, `ops: Op[]`, `history: RoundSummary[]`

- [ ] **Step 1: Write the store files**

`room/src/store/store.ts`:
```ts
import type { Op, RoundSummary } from '@gallery/shared';

export interface PersistedPlayer {
  clientId: string;
  slot: number;
  name: string;
  color: string;
  wins: number;
  lastSeen: number;
  stats: { ink: number; drawMs: number; overdraw: number };
}

export interface Meta {
  roundIdx: number;
  finalized: boolean;
  players: PersistedPlayer[];
}

export interface Store {
  loadMeta(): Meta | null;
  saveMeta(m: Meta): void;
  loadOpChunks(roundIdx: number): Op[];
  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]): void;
  saveSummary(s: RoundSummary): void;
  loadHistory(limit: number): RoundSummary[];
  pruneBefore(roundIdx: number): void;
}
```

`room/src/store/memoryStore.ts`:
```ts
import type { Op, RoundSummary } from '@gallery/shared';
import type { Meta, Store } from './store';

export class MemoryStore implements Store {
  meta: Meta | null = null;
  chunks = new Map<string, Op[]>();
  summaries = new Map<number, RoundSummary>();
  writes = 0;

  loadMeta() { return this.meta ? structuredClone(this.meta) : null; }
  saveMeta(m: Meta) { this.writes++; this.meta = structuredClone(m); }

  loadOpChunks(roundIdx: number): Op[] {
    const keys = [...this.chunks.keys()]
      .filter((k) => k.startsWith(`${roundIdx}:`))
      .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
    return keys.flatMap((k) => structuredClone(this.chunks.get(k)!));
  }
  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]) {
    this.writes++;
    this.chunks.set(`${roundIdx}:${chunk}`, structuredClone(ops));
  }

  saveSummary(s: RoundSummary) { this.summaries.set(s.idx, structuredClone(s)); }
  loadHistory(limit: number): RoundSummary[] {
    return [...this.summaries.values()].sort((a, b) => a.idx - b.idx).slice(-limit);
  }
  pruneBefore(roundIdx: number) {
    for (const k of [...this.chunks.keys()]) if (Number(k.split(':')[0]) < roundIdx) this.chunks.delete(k);
    for (const i of [...this.summaries.keys()]) if (i < roundIdx) this.summaries.delete(i);
  }
}
```

- [ ] **Step 2: Write the failing engine tests** — `room/src/game/engine.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { GameEngine } from './engine';
import { MemoryStore } from '../store/memoryStore';
import { PALETTE, type ModeId, type ServerMsg } from '@gallery/shared';
import type { Outbound } from './types';

const cfg = { roundMs: 1000, overMs: 100, order: ['paint', 'enclose'] as ModeId[], password: '' };
const mk = (now = 0, store = new MemoryStore(), c = cfg) => new GameEngine(c, store, now);
const of = <T extends ServerMsg['t']>(out: Outbound[], t: T) =>
  out.filter((o) => o.msg.t === t) as (Outbound & { msg: Extract<ServerMsg, { t: T }> })[];
const id = (n: number) => `client-${String(n).padStart(4, '0')}`;
const stroke = (sid: string, pts: number[], end = false) => ({ t: 'stroke', id: sid, pts, end });

describe('join', () => {
  it('assigns distinct colors and welcomes the joiner', () => {
    const e = mk();
    const a = e.join(id(1), 'Ann', undefined, 0);
    const b = e.join(id(2), 'Bob', undefined, 0);
    const wa = of(a, 'welcome')[0]!;
    const wb = of(b, 'welcome')[0]!;
    expect(wa.to).toEqual({ only: id(1) });
    expect(wa.msg.you).not.toBe(wb.msg.you);
    expect(of(b, 'players')[0]!.msg.players.map((p) => p.color).length).toBe(2);
    expect(new Set(of(b, 'players')[0]!.msg.players.map((p) => p.color)).size).toBe(2);
  });

  it('keeps slot and color when the same clientId rejoins', () => {
    const e = mk();
    const first = of(e.join(id(1), 'Ann', undefined, 0), 'welcome')[0]!.msg.you;
    e.disconnect(id(1), 10);
    const again = of(e.join(id(1), 'Ann', undefined, 20), 'welcome')[0]!.msg.you;
    expect(again).toBe(first);
    expect(e.players.size).toBe(1);
  });

  it('rejects a wrong password', () => {
    const e = mk(0, new MemoryStore(), { ...cfg, password: 'secret' });
    expect(of(e.join(id(1), 'Ann', 'nope', 0), 'error')[0]!.msg.reason).toBe('bad-password');
    expect(of(e.join(id(1), 'Ann', 'secret', 0), 'welcome').length).toBe(1);
  });

  it('rejects an invalid clientId', () => {
    const e = mk();
    expect(of(e.join('x', 'Ann', undefined, 0), 'error')[0]!.msg.reason).toBe('bad-join');
  });

  it('reports room-full when every slot has an online player', () => {
    const e = mk();
    for (let i = 0; i < PALETTE.length; i++) e.join(id(i), `P${i}`, undefined, 0);
    expect(of(e.join(id(99), 'Late', undefined, 0), 'error')[0]!.msg.reason).toBe('room-full');
  });

  it('sanitizes names', () => {
    const e = mk();
    e.join(id(1), '  <b>Ann</b>\u0007   the   Great and Powerful Indeed  ', undefined, 0);
    const name = e.players.get(id(1))!.name;
    expect(name).not.toMatch(/[<>\u0007]/);
    expect(name.length).toBeLessThanOrEqual(20);
    e.join(id(2), '   ', undefined, 0);
    expect(e.players.get(id(2))!.name).toBe('Anonymous');
    e.join(id(3), 12345 as unknown, undefined, 0);
    expect(e.players.get(id(3))!.name).toBe('Anonymous');
  });
});

describe('strokes (paint mode, idx 0)', () => {
  it('applies a stroke, broadcasts to others, updates scores on tick', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    const out = e.onStroke(id(1), stroke('s1', [100, 100, 200, 100]), 100);
    const msg = of(out, 'stroke')[0]!;
    expect(msg.to).toEqual({ except: id(1) });
    expect(msg.msg.pts).toEqual([100, 100, 200, 100]);
    const scores = of(e.tick(150), 'scores')[0]!.msg.shares;
    expect(Object.values(scores)[0]).toBeGreaterThan(0);
  });

  it('counts overdraw when painting over someone', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.join(id(2), 'Bob', undefined, 0);
    e.onStroke(id(1), stroke('a', [100, 100, 300, 100], true), 10);
    e.onStroke(id(2), stroke('b', [100, 100, 300, 100], true), 500);
    expect(e.players.get(id(2))!.stats.overdraw).toBeGreaterThan(0);
    expect(e.players.get(id(2))!.stats.ink).toBeGreaterThan(0);
  });

  it('ignores malformed and hostile strokes without throwing', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    const bad: unknown[] = [
      null, 'str', 5, {}, { t: 'stroke' }, stroke('s', []), stroke('s', [1]), stroke('s', [1, 2, 3]),
      stroke('s', [NaN, 1]), stroke('s', [Infinity, 1]), { t: 'stroke', id: 5, pts: [1, 2] },
      { t: 'stroke', id: 's', pts: 'abc' }, { t: 'stroke', id: 's', pts: ['a', 'b'] },
      stroke('s', new Array(5000).fill(10)), stroke('x'.repeat(500), [1, 2]),
    ];
    for (const m of bad) expect(() => e.onStroke(id(1), m, 100)).not.toThrow();
    expect(e.ops.length).toBe(0);
    expect(Object.keys(e.grid.shares()).length).toBe(0);
  });

  it('clamps out-of-bounds coordinates into the canvas', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [-500, -500, 99999, 99999]), 100);
    const op = e.ops[0]!;
    expect(op.k).toBe('s');
    if (op.k === 's') {
      for (const v of op.pts) expect(v).toBeGreaterThanOrEqual(0);
      expect(Math.max(...op.pts)).toBeLessThanOrEqual(1600);
    }
  });

  it('ignores strokes from unknown or offline players', () => {
    const e = mk();
    expect(e.onStroke(id(5), stroke('s', [1, 2]), 100)).toEqual([]);
    e.join(id(1), 'Ann', undefined, 0);
    e.disconnect(id(1), 10);
    expect(e.onStroke(id(1), stroke('s', [1, 2]), 100)).toEqual([]);
  });

  it('rate limits floods', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    for (let i = 0; i < 300; i++) e.onStroke(id(1), stroke('s', [10, 10, 20, 20]), 100);
    const op = e.ops[0]!;
    // each accepted batch adds 4 numbers; the token bucket allows ~40 in the same millisecond
    expect(op.k === 's' ? op.pts.length / 4 : 0).toBeLessThanOrEqual(41);
    expect(op.k === 's' ? op.pts.length / 4 : 0).toBeGreaterThan(0);
  });
});

describe('enclose mode (idx 1)', () => {
  const loop = [400, 400, 600, 400, 600, 600, 400, 600, 500, 300];

  it('fills a closed loop and broadcasts the fill to everyone', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const out = e.onStroke(id(1), stroke('s', loop), 1250);
    const fill = of(out, 'fill')[0]!;
    expect(fill.to).toBe('all');
    expect(e.ops.some((o) => o.k === 'f')).toBe(true);
    const share = Object.values(e.grid.shares())[0]!;
    expect(share).toBeGreaterThan(0.01);
  });

  it('rejects a fill covering more than half the canvas', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const huge = [10, 10, 1590, 10, 1590, 990, 10, 990, 800, 5];
    const out = e.onStroke(id(1), stroke('s', huge), 1250);
    expect(of(out, 'fill').length).toBe(0);
  });

  it('rejects a tiny fill', () => {
    const e = mk(1200);
    e.join(id(1), 'Ann', undefined, 1200);
    const tiny = [400, 400, 404, 400, 404, 404, 400, 404, 402, 398];
    expect(of(e.onStroke(id(1), stroke('s', tiny), 1250), 'fill').length).toBe(0);
  });
});

describe('round lifecycle', () => {
  it('finalizes at the over phase, announces a winner, then wipes on the next round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);

    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.round.phase).toBe('over');
    expect(over.winnerPid).toBe(e.players.get(id(1))!.slot);
    expect(over.wipe).toBe(false);
    expect(over.history.length).toBe(1);
    expect(e.players.get(id(1))!.wins).toBe(1);

    expect(e.onStroke(id(1), stroke('t', [1, 1, 50, 50]), 960)).toEqual([]); // over phase

    const next = of(e.tick(1000), 'round')[0]!.msg;
    expect(next.round.idx).toBe(1);
    expect(next.round.mode).toBe('enclose');
    expect(next.wipe).toBe(true);
    expect(e.ops.length).toBe(0);
    expect(e.grid.shares()).toEqual({});
  });

  it('does not leak an in-flight stroke into the next round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 200, 100]), 800);
    e.tick(1000);
    expect(e.ops.length).toBe(0);
    e.onStroke(id(1), stroke('s', [300, 300, 400, 300]), 1010);
    expect(e.ops.length).toBe(1); // a fresh op for the new round
  });

  it('records nothing and picks no winner for an empty round', () => {
    const e = mk();
    e.join(id(1), 'Ann', undefined, 0);
    const over = of(e.tick(950), 'round')[0]!.msg;
    expect(over.winnerPid).toBeNull();
    expect(over.history.length).toBe(0);
  });

  it('starts a wiped new round even if the boundary was missed entirely', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100]), 100);
    e.flush();
    const late = new GameEngine(cfg, store, 5000);
    expect(late.ops.length).toBe(0);
    expect(late.history.length).toBe(1);
  });

  it('nextEventAt points at the next phase change', () => {
    const e = mk();
    expect(e.nextEventAt(100)).toBe(900);
    expect(e.nextEventAt(950)).toBe(1000);
  });
});

describe('persistence', () => {
  it('restores players, wins, ops and ownership after a restart', () => {
    const store = new MemoryStore();
    const a = mk(0, store);
    a.join(id(1), 'Ann', undefined, 0);
    a.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    a.flush();

    const b = new GameEngine(cfg, store, 200);
    expect(b.players.get(id(1))!.name).toBe('Ann');
    expect(b.ops).toEqual(a.ops);
    expect(b.grid.shares()).toEqual(a.grid.shares());
    const welcome = of(b.join(id(1), 'Ann', undefined, 210), 'welcome')[0]!.msg;
    expect(welcome.ops.length).toBe(1);
  });

  it('does not write when nothing changed', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.flush();
    const before = store.writes;
    e.flush();
    expect(store.writes).toBe(before);
  });

  it('serves ops for past rounds', () => {
    const store = new MemoryStore();
    const e = mk(0, store);
    e.join(id(1), 'Ann', undefined, 0);
    e.onStroke(id(1), stroke('s', [100, 100, 600, 100], true), 100);
    e.tick(950);
    e.tick(1000);
    expect(e.roundOps(0).length).toBe(1);
    expect(e.roundOps(12345)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run room/src/game/engine.test.ts`
Expected: FAIL — `./engine` not found.

- [ ] **Step 4: Write the engine** — `room/src/game/engine.ts`

```ts
import {
  BRUSH_RADIUS, CANVAS_H, CANVAS_W, GRID_H, GRID_W, HISTORY_LIMIT, MAX_FILL_SHARE, MAX_OPS_POINTS,
  MAX_PTS_PER_MSG, MIN_FILL_CELLS, NAME_MAX, OP_CHUNK, PALETTE, modeForRound, phaseAt,
  type Op, type PlayerInfo, type RoundInfo, type RoundSummary, type ServerMsg,
} from '@gallery/shared';
import { decimate, type Pt } from './geometry';
import { LoopTrail } from './loops';
import { MODES } from './modes';
import { OwnershipGrid } from './ownership';
import type { EngineConfig, Outbound, PlayerState } from './types';
import type { PersistedPlayer, Store } from '../store/store';

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const BUCKET_CAP = 40;
const BUCKET_REFILL_PER_MS = 40 / 1000;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Anonymous';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return cleaned || 'Anonymous';
}

export class GameEngine {
  readonly grid = new OwnershipGrid();
  ops: Op[] = [];
  players = new Map<string, PlayerState>();
  history: RoundSummary[] = [];
  roundIdx = -1;
  finalized = false;
  winnerPid: number | null = null;

  private opPoints = 0;
  private strokeIdx = new Map<string, number>();
  private dirtyFrom = Infinity;
  private metaDirty = false;
  private scoresDirty = true;

  constructor(readonly cfg: EngineConfig, private store: Store, now: number) {
    this.restore();
    this.advance(now);
  }

  // ---- connection lifecycle ------------------------------------------------

  join(clientId: string, rawName: unknown, password: unknown, now: number): Outbound[] {
    const only = { only: typeof clientId === 'string' ? clientId : '' };
    if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
      return [{ to: only, msg: { t: 'error', reason: 'bad-join' } }];
    }
    if (this.cfg.password && password !== this.cfg.password) {
      return [{ to: only, msg: { t: 'error', reason: 'bad-password' } }];
    }
    const out = this.advance(now);
    const name = sanitizeName(rawName);
    let p = this.players.get(clientId);
    if (p) {
      p.name = name;
    } else {
      const slot = this.allocSlot();
      if (slot === null) return [{ to: only, msg: { t: 'error', reason: 'room-full' } }];
      p = this.newPlayer(clientId, slot, name, now);
      this.players.set(clientId, p);
    }
    p.online = true;
    p.lastSeen = now;
    this.metaDirty = true;
    out.push({ to: only, msg: this.welcome(p, now) });
    out.push({ to: 'all', msg: { t: 'players', players: this.playerInfos() } });
    return out;
  }

  disconnect(clientId: string, now: number): Outbound[] {
    const p = this.players.get(clientId);
    if (!p) return [];
    p.online = false;
    p.lastSeen = now;
    p.curStroke = null;
    this.metaDirty = true;
    return [{ to: 'all', msg: { t: 'players', players: this.playerInfos() } }];
  }

  // ---- drawing ---------------------------------------------------------------

  onStroke(clientId: string, raw: unknown, now: number): Outbound[] {
    const p = this.players.get(clientId);
    if (!p || !p.online) return [];
    if (!this.take(p, now)) return [];
    const out = this.advance(now);
    if (phaseAt(now, this.cfg.roundMs, this.cfg.overMs).phase !== 'playing') return out;

    const m = raw as { id?: unknown; pts?: unknown; end?: unknown } | null;
    if (!m || typeof m !== 'object') return out;
    if (typeof m.id !== 'string' || m.id.length === 0 || m.id.length > 40) return out;
    if (!Array.isArray(m.pts) || m.pts.length < 2 || m.pts.length % 2 !== 0 || m.pts.length > MAX_PTS_PER_MSG * 2) return out;
    if (this.opPoints >= MAX_OPS_POINTS) return out;

    const pts: Pt[] = [];
    for (let i = 0; i < m.pts.length; i += 2) {
      const x = m.pts[i], y = m.pts[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return out;
      pts.push({ x: clamp(Math.round(x), 0, CANVAS_W), y: clamp(Math.round(y), 0, CANVAS_H) });
    }

    const key = `${p.slot}:${m.id}`;
    const newStroke = p.curStroke !== m.id || !this.strokeIdx.has(key);
    let opIndex: number;
    let prev: Pt | null = null;
    if (newStroke) {
      opIndex = this.pushOp({ k: 's', id: m.id, pid: p.slot, pts: [] });
      this.strokeIdx.set(key, opIndex);
      p.curStroke = m.id;
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
    if (p.lastMsgAt && now - p.lastMsgAt < 500 && !newStroke) p.stats.drawMs += now - p.lastMsgAt;
    p.lastMsgAt = now;
    p.stats.overdraw += this.grid.stampPath(p.slot, path, BRUSH_RADIUS);
    this.scoresDirty = true;
    this.metaDirty = true;

    out.push({ to: { except: clientId }, msg: { t: 'stroke', id: m.id, pid: p.slot, pts: flat } });

    const mode = MODES[modeForRound(this.roundIdx, this.cfg.order)];
    for (const poly of mode.onPoints({ player: p, pts, newStroke })) this.applyFill(p, poly, out);

    if (m.end === true) p.curStroke = null;
    return out;
  }

  private applyFill(p: PlayerState, poly: Pt[], out: Outbound[]): void {
    const rounded = decimate(poly, 200).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
    const cells = this.grid.polygonCells(rounded);
    if (cells.length < MIN_FILL_CELLS || cells.length > MAX_FILL_SHARE * GRID_W * GRID_H) return;
    p.stats.overdraw += this.grid.setCells(p.slot, cells);
    const flat = rounded.flatMap((q) => [q.x, q.y]);
    this.pushOp({ k: 'f', pid: p.slot, poly: flat });
    out.push({ to: 'all', msg: { t: 'fill', pid: p.slot, poly: flat } });
  }

  // ---- clock -------------------------------------------------------------------

  tick(now: number): Outbound[] {
    const out = this.advance(now);
    if (this.scoresDirty) {
      this.scoresDirty = false;
      out.push({ to: 'all', msg: { t: 'scores', shares: this.grid.shares() } });
    }
    return out;
  }

  nextEventAt(now: number): number {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    return w.phase === 'playing' ? w.overAt : w.endsAt;
  }

  roundOps(idx: number): Op[] {
    if (!Number.isInteger(idx)) return [];
    if (idx === this.roundIdx) return this.ops;
    if (!this.history.some((h) => h.idx === idx)) return [];
    return this.store.loadOpChunks(idx);
  }

  flush(): void {
    if (this.dirtyFrom < this.ops.length) {
      for (let c = Math.floor(this.dirtyFrom / OP_CHUNK); c * OP_CHUNK < this.ops.length; c++) {
        this.store.saveOpChunk(this.roundIdx, c, this.ops.slice(c * OP_CHUNK, (c + 1) * OP_CHUNK));
      }
      this.dirtyFrom = Infinity;
      this.metaDirty = true;
    }
    if (this.metaDirty) {
      this.store.saveMeta({
        roundIdx: this.roundIdx,
        finalized: this.finalized,
        players: [...this.players.values()].map(persist),
      });
      this.metaDirty = false;
    }
  }

  // ---- internals -----------------------------------------------------------------

  private advance(now: number): Outbound[] {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    const out: Outbound[] = [];
    if (w.idx !== this.roundIdx) {
      if (this.roundIdx >= 0 && !this.finalized) this.finalize();
      this.startRound(w.idx);
      out.push({
        to: 'all',
        msg: { t: 'round', round: this.roundInfo(now), winnerPid: null, wipe: true, history: this.history },
      });
    }
    if (w.phase === 'over' && !this.finalized) {
      this.finalize();
      out.push({
        to: 'all',
        msg: { t: 'round', round: this.roundInfo(now), winnerPid: this.winnerPid, wipe: false, history: this.history },
      });
      out.push({ to: 'all', msg: { t: 'players', players: this.playerInfos() } });
    }
    return out;
  }

  private startRound(idx: number): void {
    this.roundIdx = idx;
    this.ops = [];
    this.opPoints = 0;
    this.grid.clear();
    this.strokeIdx.clear();
    this.dirtyFrom = Infinity;
    this.finalized = false;
    this.winnerPid = null;
    this.scoresDirty = true;
    for (const p of this.players.values()) {
      p.trail.reset();
      p.curStroke = null;
    }
    this.store.pruneBefore(idx - HISTORY_LIMIT);
    this.metaDirty = true;
    this.flush();
  }

  private finalize(): void {
    this.finalized = true;
    this.flush();
    const shares = this.grid.shares();
    let winner: number | null = null;
    let best = 0;
    for (const [slot, share] of Object.entries(shares)) {
      if (share > best) { best = share; winner = Number(slot); }
    }
    this.winnerPid = winner;
    if (this.ops.length === 0) { this.metaDirty = true; this.flush(); return; }
    const winnerPlayer = [...this.players.values()].find((p) => p.slot === winner);
    if (winnerPlayer) winnerPlayer.wins++;
    const players: RoundSummary['players'] = {};
    for (const p of this.players.values()) if (shares[p.slot] !== undefined) players[p.slot] = { name: p.name, color: p.color };
    const summary: RoundSummary = {
      idx: this.roundIdx,
      mode: modeForRound(this.roundIdx, this.cfg.order),
      endedAt: (this.roundIdx + 1) * this.cfg.roundMs,
      winnerPid: winner,
      shares,
      players,
    };
    this.history = [...this.history, summary].slice(-HISTORY_LIMIT);
    this.store.saveSummary(summary);
    this.metaDirty = true;
    this.flush();
  }

  private pushOp(op: Op): number {
    this.ops.push(op);
    const i = this.ops.length - 1;
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    if (op.k === 'f') this.opPoints += op.poly.length / 2;
    return i;
  }

  private restore(): void {
    const meta = this.store.loadMeta();
    this.history = this.store.loadHistory(HISTORY_LIMIT);
    if (!meta) return;
    for (const pp of meta.players) {
      this.players.set(pp.clientId, { ...pp, online: false, trail: new LoopTrail(), curStroke: null, lastMsgAt: 0, tokens: BUCKET_CAP, tokensAt: 0 });
    }
    this.roundIdx = meta.roundIdx;
    this.finalized = meta.finalized;
    this.ops = this.store.loadOpChunks(meta.roundIdx);
    const slotOf = (pid: number) => pid;
    for (const op of this.ops) {
      if (op.k === 's') {
        const pts: Pt[] = [];
        for (let i = 0; i < op.pts.length; i += 2) pts.push({ x: op.pts[i]!, y: op.pts[i + 1]! });
        this.grid.stampPath(slotOf(op.pid), pts, BRUSH_RADIUS);
        this.opPoints += pts.length;
      } else {
        const poly: Pt[] = [];
        for (let i = 0; i < op.poly.length; i += 2) poly.push({ x: op.poly[i]!, y: op.poly[i + 1]! });
        this.grid.setCells(slotOf(op.pid), this.grid.polygonCells(poly));
        this.opPoints += poly.length;
      }
    }
    if (this.finalized) {
      const shares = this.grid.shares();
      let best = 0;
      for (const [slot, share] of Object.entries(shares)) if (share > best) { best = share; this.winnerPid = Number(slot); }
    }
  }

  private allocSlot(): number | null {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let s = 1; s <= PALETTE.length; s++) if (!used.has(s)) return s;
    let oldest: PlayerState | null = null;
    for (const p of this.players.values()) if (!p.online && (!oldest || p.lastSeen < oldest.lastSeen)) oldest = p;
    if (!oldest) return null;
    this.players.delete(oldest.clientId);
    return oldest.slot;
  }

  private newPlayer(clientId: string, slot: number, name: string, now: number): PlayerState {
    return {
      clientId, slot, name, color: PALETTE[slot - 1]!, online: true, lastSeen: now, wins: 0,
      stats: { ink: 0, drawMs: 0, overdraw: 0 }, trail: new LoopTrail(), curStroke: null,
      lastMsgAt: 0, tokens: BUCKET_CAP, tokensAt: now,
    };
  }

  private take(p: PlayerState, now: number): boolean {
    p.tokens = Math.min(BUCKET_CAP, p.tokens + Math.max(0, now - p.tokensAt) * BUCKET_REFILL_PER_MS);
    p.tokensAt = now;
    if (p.tokens < 1) return false;
    p.tokens -= 1;
    return true;
  }

  private roundInfo(now: number): RoundInfo {
    const w = phaseAt(now, this.cfg.roundMs, this.cfg.overMs);
    const mode = MODES[modeForRound(w.idx, this.cfg.order)];
    return { idx: w.idx, mode: mode.id, modeName: mode.name, rules: mode.rules, phase: w.phase, startsAt: w.startsAt, overAt: w.overAt, endsAt: w.endsAt };
  }

  private playerInfos(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ pid: p.slot, name: p.name, color: p.color, online: p.online, wins: p.wins }));
  }

  private welcome(p: PlayerState, now: number): ServerMsg {
    return {
      t: 'welcome',
      serverNow: now,
      you: p.slot,
      players: this.playerInfos(),
      round: this.roundInfo(now),
      winnerPid: this.winnerPid,
      ops: this.ops,
      shares: this.grid.shares(),
      history: this.history,
    };
  }
}

function persist(p: PlayerState): PersistedPlayer {
  return { clientId: p.clientId, slot: p.slot, name: p.name, color: p.color, wins: p.wins, lastSeen: p.lastSeen, stats: p.stats };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run room/src/game/engine.test.ts`
Expected: PASS. Likely adjustments while making it green (adjust the **code** unless the test is wrong):
- `restore` finalized path and `advance` at construction must not emit stale `round` messages (ignored: return value of `advance` in the constructor is discarded).
- If the "rate limits floods" test is flaky, apply the simplification noted in Step 2 (assert only `pts.length / 4 <= 45`).
- If "keeps slot and color when rejoining" fails, ensure `join` does not call `allocSlot` for known clientIds.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add room/src
git commit -m "feat(room): game engine with rounds, scoring, persistence"
```

---

### Task 7: Cloudflare Durable Object + Worker entry + SQL store

**Files:**
- Create: `room/src/store/sqlStore.ts`, `room/src/room.ts`, `room/src/index.ts`

**Interfaces:**
- Consumes: `GameEngine`, `Store`, protocol types.
- Produces: Worker with `GET /ws` (WebSocket upgrade → Durable Object `main`) and `GET /health`. Env: `ROOM: DurableObjectNamespace`, `ROOM_PASSWORD?: string`, `ROUND_MINUTES?: string`.

No unit tests (platform glue). Verified by typecheck here and the smoke test in Task 8.

- [ ] **Step 1: Write the SQL store** — `room/src/store/sqlStore.ts`

```ts
import type { Op, RoundSummary } from '@gallery/shared';
import type { Meta, Store } from './store';

export class SqlStore implements Store {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS round_ops (round_idx INTEGER NOT NULL, chunk INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (round_idx, chunk))`,
    );
    sql.exec(`CREATE TABLE IF NOT EXISTS rounds (idx INTEGER PRIMARY KEY, json TEXT NOT NULL)`);
  }

  loadMeta(): Meta | null {
    const rows = this.sql.exec(`SELECT v FROM meta WHERE k = 'meta'`).toArray();
    return rows.length ? (JSON.parse(rows[0]!.v as string) as Meta) : null;
  }

  saveMeta(m: Meta): void {
    this.sql.exec(
      `INSERT INTO meta (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(m),
    );
  }

  loadOpChunks(roundIdx: number): Op[] {
    const rows = this.sql.exec(`SELECT json FROM round_ops WHERE round_idx = ? ORDER BY chunk`, roundIdx).toArray();
    return rows.flatMap((r) => JSON.parse(r.json as string) as Op[]);
  }

  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]): void {
    this.sql.exec(
      `INSERT INTO round_ops (round_idx, chunk, json) VALUES (?, ?, ?)
       ON CONFLICT(round_idx, chunk) DO UPDATE SET json = excluded.json`,
      roundIdx, chunk, JSON.stringify(ops),
    );
  }

  saveSummary(s: RoundSummary): void {
    this.sql.exec(`INSERT OR REPLACE INTO rounds (idx, json) VALUES (?, ?)`, s.idx, JSON.stringify(s));
  }

  loadHistory(limit: number): RoundSummary[] {
    const rows = this.sql.exec(`SELECT json FROM rounds ORDER BY idx DESC LIMIT ?`, limit).toArray();
    return rows.map((r) => JSON.parse(r.json as string) as RoundSummary).reverse();
  }

  pruneBefore(roundIdx: number): void {
    this.sql.exec(`DELETE FROM round_ops WHERE round_idx < ?`, roundIdx);
    this.sql.exec(`DELETE FROM rounds WHERE idx < ?`, roundIdx);
  }
}
```

- [ ] **Step 2: Write the Durable Object** — `room/src/room.ts`

```ts
import { MODE_ORDER, OVER_MS, ROUND_MS, type ClientMsg } from '@gallery/shared';
import { GameEngine } from './game/engine';
import type { Outbound } from './game/types';
import { SqlStore } from './store/sqlStore';

export interface Env {
  ROOM: DurableObjectNamespace;
  ROOM_PASSWORD?: string;
  ROUND_MINUTES?: string;
}

const MAX_MESSAGE_CHARS = 20_000;
const FLUSH_EVERY_TICKS = 10;

export class Room implements DurableObject {
  private engine!: GameEngine;
  private sockets = new Map<string, WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;

  constructor(private ctx: DurableObjectState, private env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      const minutes = Number(env.ROUND_MINUTES);
      const roundMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : ROUND_MS;
      const overMs = Math.min(OVER_MS, Math.floor(roundMs / 4));
      this.engine = new GameEngine(
        { roundMs, overMs, order: MODE_ORDER, password: env.ROOM_PASSWORD ?? '' },
        new SqlStore(ctx.storage.sql),
        Date.now(),
      );
      await this.scheduleAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.handle(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    this.dispatch(this.engine.tick(Date.now()));
    this.engine.flush();
    await this.scheduleAlarm();
  }

  private handle(ws: WebSocket): void {
    ws.accept();
    let clientId: string | null = null;

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MESSAGE_CHARS) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(ev.data) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const now = Date.now();

      if (msg.t === 'join') {
        if (clientId || typeof msg.clientId !== 'string') return;
        const out = this.engine.join(msg.clientId, msg.name, msg.password, now);
        if (out.some((o) => o.msg.t === 'welcome')) {
          const prev = this.sockets.get(msg.clientId);
          this.sockets.set(msg.clientId, ws);
          if (prev && prev !== ws) { try { prev.close(1000, 'replaced'); } catch { /* already closed */ } }
          clientId = msg.clientId;
          this.ensureTimer();
        }
        this.dispatch(out, ws);
        return;
      }

      if (!clientId) return;
      if (msg.t === 'stroke') {
        this.dispatch(this.engine.onStroke(clientId, msg, now));
      } else if (msg.t === 'get-round') {
        this.safeSend(ws, { t: 'round-ops', idx: msg.idx, ops: this.engine.roundOps(msg.idx) });
      }
    });

    const onClose = () => {
      if (!clientId) return;
      if (this.sockets.get(clientId) !== ws) return; // replaced by a newer connection
      this.sockets.delete(clientId);
      this.dispatch(this.engine.disconnect(clientId, Date.now()));
      if (this.sockets.size === 0) {
        this.engine.flush();
        this.stopTimer();
      }
    };
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);
  }

  private dispatch(out: Outbound[], joiner?: WebSocket): void {
    for (const { to, msg } of out) {
      if (to === 'all') {
        for (const s of this.sockets.values()) this.safeSend(s, msg);
      } else if ('only' in to) {
        const s = this.sockets.get(to.only) ?? joiner;
        if (s) this.safeSend(s, msg);
      } else {
        for (const [id, s] of this.sockets) if (id !== to.except) this.safeSend(s, msg);
      }
    }
  }

  private safeSend(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed; close handler cleans up */
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.dispatch(this.engine.tick(Date.now()));
      if (++this.ticks % FLUSH_EVERY_TICKS === 0) this.engine.flush();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scheduleAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(this.engine.nextEventAt(Date.now()) + 50);
  }
}
```

- [ ] **Step 3: Write the Worker entry** — `room/src/index.ts`

```ts
import type { Env } from './room';

export { Room } from './room';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/ws') {
      return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: no errors. If `SqlStorage` or `WebSocketPair` types are missing, confirm `@cloudflare/workers-types` is installed and `room/tsconfig.json` has `"types": ["@cloudflare/workers-types"]`.
Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add room
git commit -m "feat(room): Durable Object, Worker entry, SQLite store"
```

---

### Task 8: Smoke test against `wrangler dev`

**Files:**
- Create: `room/scripts/smoke.ts`

**Interfaces:**
- Consumes: running `wrangler dev` at `ws://localhost:8787/ws` (env `ROOM_URL` overrides).

- [ ] **Step 1: Write the smoke script** — `room/scripts/smoke.ts`

```ts
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '@gallery/shared';

const URL = process.env.ROOM_URL ?? 'ws://localhost:8787/ws';

function client(n: number) {
  const clientId = `smoke-client-${n}-${Math.random().toString(36).slice(2, 8)}`;
  const ws = new WebSocket(URL);
  const seen: ServerMsg[] = [];
  const waiters: Array<(m: ServerMsg) => void> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMsg;
    seen.push(m);
    waiters.splice(0).forEach((w) => w(m));
  });
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  const waitFor = <T extends ServerMsg['t']>(t: T, ms = 3000) =>
    new Promise<Extract<ServerMsg, { t: T }>>((resolve, reject) => {
      const hit = seen.find((m) => m.t === t);
      if (hit) return resolve(hit as Extract<ServerMsg, { t: T }>);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
      const check = (m: ServerMsg) => {
        if (m.t === t) { clearTimeout(timer); resolve(m as Extract<ServerMsg, { t: T }>); } else waiters.push(check);
      };
      waiters.push(check);
    });
  return new Promise<{ ws: WebSocket; send: typeof send; waitFor: typeof waitFor; seen: ServerMsg[]; clientId: string }>(
    (resolve) => ws.on('open', () => resolve({ ws, send, waitFor, seen, clientId })),
  );
}

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('ok  :', msg);
}

async function main() {
  const [a, b, c] = await Promise.all([client(1), client(2), client(3)]);
  a.send({ t: 'join', clientId: a.clientId, name: 'Ann' });
  b.send({ t: 'join', clientId: b.clientId, name: 'Bob' });
  c.send({ t: 'join', clientId: c.clientId, name: 'Cy' });
  const [wa, wb, wc] = await Promise.all([a.waitFor('welcome'), b.waitFor('welcome'), c.waitFor('welcome')]);
  assert(new Set([wa.you, wb.you, wc.you]).size === 3, 'three clients get distinct slots');

  a.send({ t: 'stroke', id: 'smoke1', pts: [100, 100, 300, 120, 500, 100] });
  const seenByB = await b.waitFor('stroke');
  assert(seenByB.pid === wa.you && seenByB.pts.length === 6, 'other clients receive the stroke');
  assert(!a.seen.some((m) => m.t === 'stroke'), 'sender does not receive its own stroke back');

  const scores = await b.waitFor('scores', 4000);
  assert((scores.shares[wa.you] ?? 0) > 0, 'scores show territory for the painter');

  a.send({ t: 'stroke', id: 'bad', pts: [NaN, 1, 'x', 2] as unknown as number[] });
  a.ws.send('not json');
  await new Promise((r) => setTimeout(r, 300));
  assert(a.ws.readyState === WebSocket.OPEN, 'server survives malformed input');

  const again = await client(1);
  again.send({ t: 'join', clientId: a.clientId, name: 'Ann' });
  const w2 = await again.waitFor('welcome');
  assert(w2.you === wa.you, 'same clientId gets the same slot after reconnecting');
  assert(w2.ops.length >= 1, 'reconnecting client receives the existing canvas');

  [a, b, c, again].forEach((x) => x.ws.close());
  console.log('\nSmoke test passed.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

In terminal 1: `npm run dev:room`
In terminal 2: `npm run smoke -w room`
Expected: all lines print `ok  :` and the script ends with `Smoke test passed.`. If `wrangler dev` needs a login prompt for telemetry, answer no; local dev doesn't need a Cloudflare account.

- [ ] **Step 3: Commit**

```bash
git add room/scripts
git commit -m "test(room): multi-client smoke test"
```

---

### Task 9: Web state reducer and WebSocket hook

**Files:**
- Create: `web/src/session.ts`, `web/src/state/roomReducer.ts`, `web/src/net/useRoom.ts`
- Test: `web/src/state/roomReducer.test.ts`

**Interfaces:**
- Consumes: `ServerMsg`, `PlayerInfo`, `RoundInfo`, `RoundSummary`, `Op` from `@gallery/shared`
- Produces:
  - `RoomState { conn: 'connecting'|'open'|'closed'; error: string|null; you: number|null; players: PlayerInfo[]; shares: Record<number,number>; round: RoundInfo|null; winnerPid: number|null; history: RoundSummary[]; clockOffset: number }`
  - `initialState: RoomState`, `reduce(state: RoomState, action: Action): RoomState`, `type Action = { type: 'conn'; conn: RoomState['conn'] } | { type: 'server'; msg: ServerMsg; localNow: number }`
  - `useRoom(opts: { url: string; clientId: string; name: string | null; password?: string }): { state: RoomState; send(msg: ClientMsg): void; subscribe(fn: (m: ServerMsg) => void): () => void; getRoundOps(idx: number): Promise<Op[]> }`
  - `session.ts`: `getClientId(): string`, `getSavedName(): string | null`, `saveName(n: string): void`, `clearName(): void`

- [ ] **Step 1: Write the failing test** — `web/src/state/roomReducer.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { initialState, reduce } from './roomReducer';
import type { RoundInfo, ServerMsg } from '@gallery/shared';

const round: RoundInfo = {
  idx: 5, mode: 'paint', modeName: 'Paint War', rules: 'r', phase: 'playing', startsAt: 0, overAt: 900, endsAt: 1000,
};
const welcome: ServerMsg = {
  t: 'welcome', serverNow: 10_000, you: 3,
  players: [{ pid: 3, name: 'Ann', color: '#fff', online: true, wins: 0 }],
  round, winnerPid: null, ops: [], shares: { 3: 0.1 }, history: [],
};
const srv = (msg: ServerMsg, localNow = 9_000) => ({ type: 'server' as const, msg, localNow });

describe('roomReducer', () => {
  it('stores welcome data and computes the clock offset', () => {
    const s = reduce(initialState, srv(welcome));
    expect(s.you).toBe(3);
    expect(s.round?.idx).toBe(5);
    expect(s.shares[3]).toBe(0.1);
    expect(s.clockOffset).toBe(1000);
    expect(s.error).toBeNull();
  });

  it('tracks connection state', () => {
    expect(reduce(initialState, { type: 'conn', conn: 'open' }).conn).toBe('open');
  });

  it('replaces players and scores', () => {
    let s = reduce(initialState, srv(welcome));
    s = reduce(s, srv({ t: 'players', players: [] }));
    expect(s.players).toEqual([]);
    s = reduce(s, srv({ t: 'scores', shares: { 3: 0.4 } }));
    expect(s.shares[3]).toBe(0.4);
  });

  it('on a wiping round message clears scores and winner', () => {
    let s = reduce(initialState, srv(welcome));
    s = reduce(s, srv({ t: 'round', round: { ...round, idx: 6 }, winnerPid: null, wipe: true, history: [] }));
    expect(s.round?.idx).toBe(6);
    expect(s.shares).toEqual({});
    expect(s.winnerPid).toBeNull();
  });

  it('on an over round message keeps scores and sets the winner', () => {
    let s = reduce(initialState, srv(welcome));
    s = reduce(s, srv({ t: 'round', round: { ...round, phase: 'over' }, winnerPid: 3, wipe: false, history: [] }));
    expect(s.round?.phase).toBe('over');
    expect(s.winnerPid).toBe(3);
    expect(s.shares[3]).toBe(0.1);
  });

  it('stores server errors', () => {
    const s = reduce(initialState, srv({ t: 'error', reason: 'room-full' }));
    expect(s.error).toBe('room-full');
  });

  it('ignores messages it does not hold in state', () => {
    const s = reduce(initialState, srv({ t: 'stroke', id: 'a', pid: 1, pts: [1, 2] }));
    expect(s).toBe(initialState);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/state`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`web/src/state/roomReducer.ts`:
```ts
import type { PlayerInfo, RoundInfo, RoundSummary, ServerMsg } from '@gallery/shared';

export interface RoomState {
  conn: 'connecting' | 'open' | 'closed';
  error: string | null;
  you: number | null;
  players: PlayerInfo[];
  shares: Record<number, number>;
  round: RoundInfo | null;
  winnerPid: number | null;
  history: RoundSummary[];
  clockOffset: number;
}

export const initialState: RoomState = {
  conn: 'connecting', error: null, you: null, players: [], shares: {}, round: null, winnerPid: null, history: [], clockOffset: 0,
};

export type Action =
  | { type: 'conn'; conn: RoomState['conn'] }
  | { type: 'server'; msg: ServerMsg; localNow: number };

export function reduce(state: RoomState, action: Action): RoomState {
  if (action.type === 'conn') return { ...state, conn: action.conn };
  const m = action.msg;
  switch (m.t) {
    case 'welcome':
      return {
        ...state, error: null, you: m.you, players: m.players, round: m.round, winnerPid: m.winnerPid,
        shares: m.shares, history: m.history, clockOffset: m.serverNow - action.localNow,
      };
    case 'players': return { ...state, players: m.players };
    case 'scores': return { ...state, shares: m.shares };
    case 'round':
      return {
        ...state, round: m.round, winnerPid: m.winnerPid, history: m.history,
        shares: m.wipe ? {} : state.shares,
      };
    case 'error': return { ...state, error: m.reason };
    default: return state;
  }
}
```

`web/src/session.ts`:
```ts
const ID_KEY = 'gallery.clientId';
const NAME_KEY = 'gallery.name';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

export function getClientId(): string {
  let id = safeGet(ID_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = crypto.randomUUID();
    safeSet(ID_KEY, id);
  }
  return id;
}

export const getSavedName = () => safeGet(NAME_KEY);
export const saveName = (n: string) => safeSet(NAME_KEY, n);
export function clearName(): void {
  try { localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
}
```

`web/src/net/useRoom.ts`:
```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientMsg, Op, ServerMsg } from '@gallery/shared';
import { initialState, reduce, type RoomState } from '../state/roomReducer';

interface Opts { url: string; clientId: string; name: string | null; password?: string }

export function useRoom({ url, clientId, name, password }: Opts) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<(m: ServerMsg) => void>());
  const pending = useRef(new Map<number, (ops: Op[]) => void>());
  const cache = useRef(new Map<number, Op[]>());

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const subscribe = useCallback((fn: (m: ServerMsg) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  const getRoundOps = useCallback((idx: number) => {
    const hit = cache.current.get(idx);
    if (hit) return Promise.resolve(hit);
    return new Promise<Op[]>((resolve) => {
      pending.current.set(idx, resolve);
      send({ t: 'get-round', idx });
    });
  }, [send]);

  useEffect(() => {
    if (!name) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      dispatch({ type: 'conn', conn: 'connecting' });
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatch({ type: 'conn', conn: 'open' });
        ws.send(JSON.stringify({ t: 'join', clientId, name, password } satisfies ClientMsg));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
        if (msg.t === 'round-ops') {
          cache.current.set(msg.idx, msg.ops);
          pending.current.get(msg.idx)?.(msg.ops);
          pending.current.delete(msg.idx);
        }
        dispatch({ type: 'server', msg, localNow: Date.now() });
        listeners.current.forEach((fn) => fn(msg));
      };
      ws.onclose = () => {
        if (closed) return;
        dispatch({ type: 'conn', conn: 'closed' });
        retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [url, clientId, name, password]);

  return { state: state as RoomState, send, subscribe, getRoundOps };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/src/state`
Expected: PASS (7 tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): room state reducer and WebSocket hook"
```

---

### Task 10: Canvas rendering, input, and cursors

**Files:**
- Create: `web/src/canvas/render.ts`, `web/src/canvas/PaintCanvas.tsx`, `web/src/canvas/CursorLayer.tsx`
- Test: `web/src/canvas/render.test.ts` (pure helper only)

**Interfaces:**
- Consumes: `Op`, `PlayerInfo`, `ServerMsg`, `CANVAS_W/H`, `BRUSH_RADIUS`; `useRoom`'s `send`/`subscribe`.
- Produces:
  - `render.ts`: `clearCanvas(ctx)`, `drawOps(ctx, ops: Op[], colorOf: (pid: number) => string, scale = 1)`, `drawSegment(ctx, color, pts: number[], prev: {x,y}|null, scale = 1)`, `drawFill(ctx, color, poly: number[], scale = 1)`, `chunkPoints(flat: number[], max: number): number[][]`
  - `PaintCanvas({ send, subscribe, players, you, enabled, cursors }: {...})`
  - `CursorLayer({ cursors, players, you }: {...})`
  - `type CursorMap = Map<number, { x: number; y: number; at: number }>`

- [ ] **Step 1: Write the failing test** — `web/src/canvas/render.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chunkPoints } from './render';

describe('chunkPoints', () => {
  it('splits a flat point array into pairs-aligned chunks, repeating the join point', () => {
    const flat = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const chunks = chunkPoints(flat, 2); // max 2 points per chunk
    expect(chunks.every((c) => c.length % 2 === 0)).toBe(true);
    expect(chunks.every((c) => c.length / 2 <= 2)).toBe(true);
    expect(chunks.flat()).toEqual(flat);
    expect(chunks[0]).toEqual([0, 0, 1, 1]);
  });
  it('returns one chunk when under the limit', () => {
    expect(chunkPoints([1, 2, 3, 4], 64)).toEqual([[1, 2, 3, 4]]);
  });
  it('returns nothing for empty input', () => {
    expect(chunkPoints([], 64)).toEqual([]);
  });
});
```

(Chunks never repeat points: the server's engine joins consecutive batches of one stroke using its own last stored point.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/src/canvas`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `render.ts`**

```ts
import { BRUSH_RADIUS, CANVAS_H, CANVAS_W, type Op } from '@gallery/shared';

export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#f7f1e3';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawSegment(
  ctx: CanvasRenderingContext2D, color: string, pts: number[], prev: { x: number; y: number } | null, scale = 1,
): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = BRUSH_RADIUS * 2 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!prev && pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0]! * scale, pts[1]! * scale, BRUSH_RADIUS * scale, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (prev) ctx.moveTo(prev.x * scale, prev.y * scale);
  else ctx.moveTo(pts[0]! * scale, pts[1]! * scale);
  for (let i = prev ? 0 : 2; i < pts.length; i += 2) ctx.lineTo(pts[i]! * scale, pts[i + 1]! * scale);
  ctx.stroke();
}

export function drawFill(ctx: CanvasRenderingContext2D, color: string, poly: number[], scale = 1): void {
  if (poly.length < 6) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0]! * scale, poly[1]! * scale);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i]! * scale, poly[i + 1]! * scale);
  ctx.closePath();
  ctx.fill();
}

export function drawOps(
  ctx: CanvasRenderingContext2D, ops: Op[], colorOf: (pid: number) => string, scale = 1,
): void {
  for (const op of ops) {
    if (op.k === 's') drawSegment(ctx, colorOf(op.pid), op.pts, null, scale);
    else drawFill(ctx, colorOf(op.pid), op.poly, scale);
  }
}

/** Split a flat [x,y,...] array into chunks of at most `max` points, without repeating points. */
export function chunkPoints(flat: number[], max: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += max * 2) out.push(flat.slice(i, i + max * 2));
  return out;
}

export const CANVAS_SIZE = { w: CANVAS_W, h: CANVAS_H };
```

- [ ] **Step 4: Write `PaintCanvas.tsx`**

```tsx
import { useEffect, useRef, type MutableRefObject } from 'react';
import { CANVAS_H, CANVAS_W, MAX_PTS_PER_MSG, type ClientMsg, type PlayerInfo, type ServerMsg } from '@gallery/shared';
import { chunkPoints, clearCanvas, drawFill, drawOps, drawSegment } from './render';

export type CursorMap = Map<number, { x: number; y: number; at: number }>;

interface Props {
  send: (m: ClientMsg) => void;
  subscribe: (fn: (m: ServerMsg) => void) => () => void;
  players: PlayerInfo[];
  you: number | null;
  enabled: boolean;
  cursors: MutableRefObject<CursorMap>;
}

const FLUSH_MS = 66;

export function PaintCanvas({ send, subscribe, players, you, enabled, cursors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useRef(new Map<number, string>());
  const lastPt = useRef(new Map<string, { x: number; y: number }>());
  const draw = useRef<{ id: string; buf: number[]; timer: ReturnType<typeof setInterval> } | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const youRef = useRef(you);
  youRef.current = you;

  useEffect(() => {
    colors.current = new Map(players.map((p) => [p.pid, p.color]));
  }, [players]);

  const colorOf = (pid: number) => colors.current.get(pid) ?? '#888888';
  const ctx = () => canvasRef.current!.getContext('2d')!;

  useEffect(() => {
    clearCanvas(ctx());
    return subscribe((m) => {
      const c = ctx();
      if (m.t === 'welcome') {
        colors.current = new Map(m.players.map((p) => [p.pid, p.color]));
        lastPt.current.clear();
        clearCanvas(c);
        drawOps(c, m.ops, colorOf);
      } else if (m.t === 'round' && m.wipe) {
        lastPt.current.clear();
        clearCanvas(c);
        cursors.current.clear();
      } else if (m.t === 'stroke') {
        const key = `${m.pid}:${m.id}`;
        drawSegment(c, colorOf(m.pid), m.pts, lastPt.current.get(key) ?? null);
        lastPt.current.set(key, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]! });
        cursors.current.set(m.pid, { x: m.pts[m.pts.length - 2]!, y: m.pts[m.pts.length - 1]!, at: performance.now() });
      } else if (m.t === 'fill') {
        drawFill(c, colorOf(m.pid), m.poly);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * CANVAS_W),
      y: Math.round(((e.clientY - r.top) / r.height) * CANVAS_H),
    };
  };

  const flush = (end: boolean) => {
    const d = draw.current;
    if (!d) return;
    const chunks = chunkPoints(d.buf, MAX_PTS_PER_MSG);
    d.buf = [];
    if (chunks.length === 0 && end) {
      // nothing buffered; send a zero-length end marker is not allowed by the server, so just stop
      return;
    }
    chunks.forEach((pts, i) => send({ t: 'stroke', id: d.id, pts, end: end && i === chunks.length - 1 }));
  };

  const onDown = (e: React.PointerEvent) => {
    if (!enabledRef.current || youRef.current === null || draw.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = Math.random().toString(36).slice(2, 10);
    const p = toCanvas(e);
    drawSegment(ctx(), colorOf(youRef.current), [p.x, p.y], null);
    lastPt.current.set(`${youRef.current}:${id}`, p);
    draw.current = { id, buf: [p.x, p.y], timer: setInterval(() => flush(false), FLUSH_MS) };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = draw.current;
    if (!d) return;
    if (!enabledRef.current) return onUp();
    const p = toCanvas(e);
    const key = `${youRef.current}:${d.id}`;
    drawSegment(ctx(), colorOf(youRef.current!), [p.x, p.y], lastPt.current.get(key) ?? null);
    lastPt.current.set(key, p);
    d.buf.push(p.x, p.y);
  };

  function onUp() {
    const d = draw.current;
    if (!d) return;
    clearInterval(d.timer);
    flush(true);
    draw.current = null;
  }

  useEffect(() => () => { if (draw.current) clearInterval(draw.current.timer); }, []);

  return (
    <canvas
      ref={canvasRef}
      className="paint-canvas"
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ cursor: enabled ? 'crosshair' : 'not-allowed', touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
```

Note: the local stroke ends with `end: true` only if points remain buffered; if the buffer is empty at pen-up (the 66 ms timer just flushed everything), the server keeps `curStroke` open until the next stroke id arrives, which is harmless (a new id starts a new stroke).

- [ ] **Step 5: Write `CursorLayer.tsx`**

```tsx
import { useEffect, useRef, type MutableRefObject } from 'react';
import { CANVAS_H, CANVAS_W, type PlayerInfo } from '@gallery/shared';
import type { CursorMap } from './PaintCanvas';

const VISIBLE_MS = 2000;

interface Props { cursors: MutableRefObject<CursorMap>; players: PlayerInfo[]; you: number | null }

export function CursorLayer({ cursors, players, you }: Props) {
  const els = useRef(new Map<number, HTMLDivElement>());
  const smooth = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      for (const [pid, el] of els.current) {
        const c = cursors.current.get(pid);
        if (!c || now - c.at > VISIBLE_MS) { el.style.opacity = '0'; smooth.current.delete(pid); continue; }
        const s = smooth.current.get(pid) ?? { x: c.x, y: c.y };
        s.x += (c.x - s.x) * 0.35;
        s.y += (c.y - s.y) * 0.35;
        smooth.current.set(pid, s);
        el.style.opacity = '1';
        el.style.transform = `translate(${(s.x / CANVAS_W) * 100}cqw, ${(s.y / CANVAS_H) * 100}cqh)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cursors]);

  return (
    <div className="cursor-layer">
      {players.filter((p) => p.online && p.pid !== you).map((p) => (
        <div
          key={p.pid}
          className="cursor"
          ref={(el) => { if (el) els.current.set(p.pid, el); else els.current.delete(p.pid); }}
          style={{ ['--c' as string]: p.color }}
        >
          <span className="cursor-dot" />
          <span className="cursor-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}
```

(`cqw`/`cqh` rely on the cursor layer's parent `.canvas-wrap` having `container-type: size`, set in Task 11's CSS.)

- [ ] **Step 6: Run to verify tests pass**

Run: `npx vitest run web/src/canvas`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/canvas
git commit -m "feat(web): canvas rendering, drawing input, cursors"
```

---

### Task 11: Gallery scene, leaderboard, plaque, round-over, join screen, App wiring

**Files:**
- Create: `web/src/gallery/Gallery.tsx`, `web/src/gallery/Plaque.tsx`, `web/src/gallery/Leaderboard.tsx`, `web/src/gallery/RoundOver.tsx`, `web/src/gallery/JoinScreen.tsx`, `web/src/gallery/gallery.css`, `web/src/useNow.ts`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`
- Create: `web/.env.example`

**Interfaces:**
- Consumes: `useRoom`, `PaintCanvas`, `CursorLayer`, `RoomState`, `session.ts`.
- Produces: the full single-page app. `VITE_ROOM_URL` env (default `ws://localhost:8787/ws`).

- [ ] **Step 1: Write helper and small components**

`web/src/useNow.ts`:
```ts
import { useEffect, useState } from 'react';

/** Server-aligned "now" that re-renders every `ms`. */
export function useNow(clockOffset: number, ms = 250): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + clockOffset), ms);
    return () => clearInterval(t);
  }, [clockOffset, ms]);
  return now;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
```

`web/src/gallery/Plaque.tsx`:
```tsx
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
```

`web/src/gallery/Leaderboard.tsx`:
```tsx
import type { PlayerInfo } from '@gallery/shared';

interface Props { players: PlayerInfo[]; shares: Record<number, number>; you: number | null }

export function Leaderboard({ players, shares, you }: Props) {
  const rows = players
    .map((p) => ({ ...p, share: shares[p.pid] ?? 0 }))
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
```

`web/src/gallery/RoundOver.tsx`:
```tsx
import type { PlayerInfo, RoundInfo } from '@gallery/shared';
import { formatCountdown } from '../useNow';

interface Props { round: RoundInfo; winner: PlayerInfo | undefined; share: number; now: number }

export function RoundOver({ round, winner, share, now }: Props) {
  return (
    <div className="round-over">
      <div className="round-over-card">
        <div className="eyebrow">Round over</div>
        {winner ? (
          <>
            <div className="winner" style={{ color: winner.color }}>{winner.name}</div>
            <div className="winner-line">wins with {(share * 100).toFixed(1)}% of the canvas</div>
          </>
        ) : (
          <div className="winner-line">Nobody painted this round</div>
        )}
        <div className="next">Next canvas in {formatCountdown(round.endsAt - now)}</div>
      </div>
    </div>
  );
}
```

`web/src/gallery/JoinScreen.tsx`:
```tsx
import { useState } from 'react';

interface Props { error: string | null; onJoin: (name: string, password?: string) => void }

export function JoinScreen({ error, onJoin }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const needsPassword = error === 'bad-password';
  return (
    <div className="join">
      <form
        className="join-card"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onJoin(name.trim(), password || undefined); }}
      >
        <h1>Canvas Gallery</h1>
        <p>Pick a name and step up to the wall.</p>
        <input autoFocus maxLength={20} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        {needsPassword && (
          <input type="password" placeholder="Room password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {error === 'room-full' && <div className="join-error">The gallery is full right now. Try again soon.</div>}
        {error === 'bad-password' && <div className="join-error">That password didn't work.</div>}
        <button type="submit" disabled={!name.trim()}>Enter the gallery</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `Gallery.tsx` (scene layout) and `App.tsx`**

`web/src/gallery/Gallery.tsx`:
```tsx
import { useRef, type ReactNode } from 'react';
import type { ClientMsg, Op, ServerMsg } from '@gallery/shared';
import type { RoomState } from '../state/roomReducer';
import { PaintCanvas, type CursorMap } from '../canvas/PaintCanvas';
import { CursorLayer } from '../canvas/CursorLayer';
import { useNow } from '../useNow';
import { Plaque } from './Plaque';
import { Leaderboard } from './Leaderboard';
import { RoundOver } from './RoundOver';
import { PastRounds } from './PastRounds';

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  subscribe: (fn: (m: ServerMsg) => void) => () => void;
  getRoundOps: (idx: number) => Promise<Op[]>;
  onLeave: () => void;
  children?: ReactNode;
}

export function Gallery({ state, send, subscribe, getRoundOps, onLeave }: Props) {
  const cursors = useRef<CursorMap>(new Map());
  const now = useNow(state.clockOffset);
  const round = state.round;
  const playing = round?.phase === 'playing' && state.conn === 'open';
  const winner = state.players.find((p) => p.pid === state.winnerPid);

  return (
    <div className="gallery">
      <header className="marquee">
        <span>Canvas Gallery</span>
        <span className="conn">{state.conn === 'open' ? '' : state.conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        <button className="leave" onClick={onLeave}>Not you?</button>
      </header>
      <main className="wall">
        <Leaderboard players={state.players} shares={state.shares} you={state.you} />
        <section className="centerpiece">
          <div className="frame">
            <div className="mat">
              <div className="canvas-wrap">
                <PaintCanvas
                  send={send} subscribe={subscribe} players={state.players} you={state.you} enabled={playing} cursors={cursors}
                />
                <CursorLayer cursors={cursors} players={state.players} you={state.you} />
                {round?.phase === 'over' && (
                  <RoundOver round={round} winner={winner} share={state.shares[state.winnerPid ?? -1] ?? 0} now={now} />
                )}
              </div>
            </div>
          </div>
          <Plaque round={round} now={now} />
        </section>
        <PastRounds history={state.history} getRoundOps={getRoundOps} />
      </main>
      <div className="floor" />
    </div>
  );
}
```

`web/src/App.tsx`:
```tsx
import { useState } from 'react';
import { clearName, getClientId, getSavedName, saveName } from './session';
import { useRoom } from './net/useRoom';
import { Gallery } from './gallery/Gallery';
import { JoinScreen } from './gallery/JoinScreen';
import './gallery/gallery.css';

const ROOM_URL = import.meta.env.VITE_ROOM_URL ?? 'ws://localhost:8787/ws';
const clientId = getClientId();

export function App() {
  const [name, setName] = useState<string | null>(getSavedName());
  const [password, setPassword] = useState<string | undefined>();
  const { state, send, subscribe, getRoundOps } = useRoom({ url: ROOM_URL, clientId, name, password });

  const joined = name !== null && state.you !== null && state.error === null;
  if (!joined) {
    return (
      <JoinScreen
        error={state.error}
        onJoin={(n, pw) => { saveName(n); setName(n); setPassword(pw); }}
      />
    );
  }
  return (
    <Gallery
      state={state}
      send={send}
      subscribe={subscribe}
      getRoundOps={getRoundOps}
      onLeave={() => { clearName(); location.reload(); }}
    />
  );
}
```

Note: if a saved name exists but the server later reports `bad-password` or `room-full`, `joined` is false and the join screen shows with the error; entering the name again retries (the effect re-runs because `password` changes, or the user can reload).

`web/.env.example`:
```
VITE_ROOM_URL=ws://localhost:8787/ws
```

- [ ] **Step 3: Write `gallery.css`** (museum look)

```css
:root {
  --wall: #2a1f1a;
  --wall-light: #4a372c;
  --gold: #c9a24b;
  --gold-dark: #7a5c1e;
  --paper: #f7f1e3;
  --ink: #2b2118;
  font-family: 'Cormorant Garamond', Georgia, serif;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: #120d0a; color: #efe3cf; }

.gallery { min-height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }

.marquee {
  display: flex; align-items: center; gap: 16px; padding: 14px 28px;
  font-family: 'Playfair Display', serif; font-size: 22px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--gold); background: linear-gradient(#0e0a08, #1b1310); border-bottom: 2px solid var(--gold-dark);
}
.marquee .conn { font-size: 13px; letter-spacing: .08em; color: #d98c6a; text-transform: none; }
.marquee .leave { margin-left: auto; background: none; border: 0; color: #8d7a63; font: inherit; font-size: 14px; cursor: pointer; text-transform: none; letter-spacing: 0; }

.wall {
  flex: 1; display: grid; grid-template-columns: 240px minmax(0, 1fr) 240px; gap: 28px; align-items: start;
  padding: 28px 32px 56px;
  background:
    radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255, 226, 170, .22), transparent 70%),
    radial-gradient(ellipse 40% 40% at 15% 10%, rgba(255, 226, 170, .10), transparent 70%),
    radial-gradient(ellipse 40% 40% at 85% 10%, rgba(255, 226, 170, .10), transparent 70%),
    linear-gradient(var(--wall-light), var(--wall) 65%);
}

.centerpiece { display: flex; flex-direction: column; align-items: center; gap: 22px; min-width: 0; }

.frame {
  width: 100%; max-width: 1100px; padding: 18px; border-radius: 3px;
  background: linear-gradient(135deg, #e7c872, #a07a2c 40%, #e1be67 60%, #7a5c1e);
  box-shadow: 0 0 0 2px #4b3511, 0 26px 50px rgba(0, 0, 0, .6), 0 4px 0 #3b2a0d, inset 0 0 8px rgba(0, 0, 0, .5);
}
.mat { background: #efe6d2; padding: 26px; box-shadow: inset 0 0 14px rgba(0, 0, 0, .35); }
.canvas-wrap {
  position: relative; width: 100%; aspect-ratio: 16 / 10; container-type: size;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .35), inset 0 0 6px rgba(0, 0, 0, .3);
}
.paint-canvas { width: 100%; height: 100%; display: block; background: var(--paper); }

.cursor-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cursor { position: absolute; left: 0; top: 0; opacity: 0; transition: opacity .25s; will-change: transform; }
.cursor-dot { display: block; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); }
.cursor-name { position: absolute; left: 10px; top: 6px; padding: 1px 7px; border-radius: 9px; font: 600 13px/1.4 system-ui, sans-serif; color: #fff; background: var(--c); text-shadow: 0 1px 1px rgba(0, 0, 0, .6); white-space: nowrap; }

.plaque {
  min-width: 340px; max-width: 520px; padding: 12px 26px; text-align: center; color: #2a1d06; border-radius: 3px;
  background: linear-gradient(135deg, #e9d28f, #b8934a 50%, #e4cd88);
  box-shadow: 0 6px 14px rgba(0, 0, 0, .5), inset 0 0 0 1px rgba(255, 255, 255, .35);
}
.plaque-title { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; letter-spacing: .06em; }
.plaque-rules { font-size: 17px; font-style: italic; margin: 4px 0 6px; }
.plaque-clock { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }

.placard {
  padding: 18px 16px; color: var(--ink); background: #efe6d2; border-radius: 2px;
  box-shadow: 0 10px 22px rgba(0, 0, 0, .5), inset 0 0 0 4px #efe6d2, inset 0 0 0 5px rgba(0, 0, 0, .25);
}
.placard h2 { margin: 0 0 10px; font-family: 'Playfair Display', serif; font-size: 20px; text-align: center; letter-spacing: .1em; text-transform: uppercase; }
.placard ol { list-style: none; margin: 0; padding: 0; }
.placard li { display: grid; grid-template-columns: 14px 1fr auto 34px; gap: 8px; align-items: center; padding: 5px 0; font-size: 18px; border-bottom: 1px dotted rgba(0, 0, 0, .25); }
.placard li.me { font-weight: 700; }
.placard li.empty { display: block; text-align: center; opacity: .6; border: 0; }
.swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .4); }
.lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-pct { font-variant-numeric: tabular-nums; }
.lb-wins { color: #9a6d00; font-size: 14px; text-align: right; }

.past { display: flex; flex-direction: column; gap: 22px; align-items: center; }
.past h2 { margin: 0; font-family: 'Playfair Display', serif; font-size: 16px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); }
.mini-frame { padding: 5px; background: linear-gradient(135deg, #d9b968, #8a6824); box-shadow: 0 8px 14px rgba(0, 0, 0, .55); cursor: pointer; border: 0; }
.mini-frame canvas { display: block; width: 200px; height: 125px; background: var(--paper); }
.mini-label { margin-top: 4px; font-size: 14px; text-align: center; color: #cdb98f; }

.lightbox { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; background: rgba(8, 5, 3, .86); }
.lightbox-inner { padding: 14px; background: linear-gradient(135deg, #e7c872, #a07a2c 50%, #e1be67); max-width: 92vw; }
.lightbox canvas { display: block; width: min(86vw, 1100px); aspect-ratio: 16 / 10; background: var(--paper); }
.lightbox-caption { padding-top: 8px; text-align: center; color: #2a1d06; font-size: 18px; font-weight: 600; }

.round-over { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(15, 10, 6, .62); backdrop-filter: blur(2px); }
.round-over-card { padding: 24px 40px; text-align: center; background: #efe6d2; color: var(--ink); border: 3px double var(--gold-dark); box-shadow: 0 16px 40px rgba(0, 0, 0, .6); }
.eyebrow { font-size: 15px; letter-spacing: .3em; text-transform: uppercase; opacity: .7; }
.winner { font-family: 'Playfair Display', serif; font-size: 44px; font-weight: 700; text-shadow: 0 1px 0 rgba(0, 0, 0, .35); }
.winner-line { font-size: 22px; }
.next { margin-top: 10px; font-size: 16px; opacity: .7; }

.floor {
  height: 120px; margin-top: -60px; position: relative; z-index: 1;
  background: repeating-linear-gradient(90deg, #3a2615 0 120px, #432c19 120px 240px), linear-gradient(#1a100a, #0c0705);
  background-blend-mode: multiply; box-shadow: inset 0 24px 30px rgba(0, 0, 0, .6);
}

.join { min-height: 100%; display: grid; place-items: center; background: radial-gradient(ellipse at 50% 20%, #4a372c, #17100c 70%); }
.join-card { width: min(92vw, 380px); padding: 30px; text-align: center; background: #efe6d2; color: var(--ink); border: 3px double var(--gold-dark); box-shadow: 0 20px 50px rgba(0, 0, 0, .6); }
.join-card h1 { margin: 0 0 6px; font-family: 'Playfair Display', serif; letter-spacing: .08em; }
.join-card p { margin: 0 0 16px; font-size: 19px; }
.join-card input { width: 100%; padding: 10px 12px; margin-bottom: 12px; font: inherit; font-size: 20px; background: #fffaf0; border: 1px solid #a89572; }
.join-card button { width: 100%; padding: 10px; font: 600 20px 'Cormorant Garamond', serif; letter-spacing: .08em; color: #2a1d06; background: linear-gradient(#e9d28f, #b8934a); border: 1px solid #7a5c1e; cursor: pointer; }
.join-card button:disabled { opacity: .5; cursor: default; }
.join-error { margin-bottom: 10px; color: #9b2c2c; font-size: 17px; }

@media (max-width: 1100px) {
  .wall { grid-template-columns: 1fr; }
  .past { flex-direction: row; flex-wrap: wrap; justify-content: center; }
}
```

- [ ] **Step 4: Stub `PastRounds` so the app compiles**

Create `web/src/gallery/PastRounds.tsx` as a minimal placeholder that Task 12 replaces entirely:
```tsx
import type { Op, RoundSummary } from '@gallery/shared';

export function PastRounds(_props: { history: RoundSummary[]; getRoundOps: (idx: number) => Promise<Op[]> }) {
  return <div className="past" />;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build -w web`
Expected: build succeeds.

Manual check (use the `run` skill or two browser tabs): start `npm run dev:room` and `npm run dev:web`, open `http://localhost:5173` in two tabs with different names. Verify: join screen → gallery; each tab has a different color in the leaderboard; drawing in tab A appears live in tab B with A's cursor and name; leaderboard percent rises; countdown ticks; refreshing a tab keeps the same color and the drawing.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): gallery scene, leaderboard, plaque, join flow"
```

---

### Task 12: Past rounds gallery

**Files:**
- Modify (replace): `web/src/gallery/PastRounds.tsx`
- Test: none (visual); covered by manual check below.

**Interfaces:**
- Consumes: `RoundSummary[]`, `getRoundOps(idx): Promise<Op[]>`, `drawOps`, `clearCanvas`.
- Produces: `PastRounds({ history, getRoundOps })` showing the latest 6 finished rounds as small framed thumbnails; clicking opens a lightbox with the full canvas and caption (mode, winner, time).

- [ ] **Step 1: Replace `PastRounds.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W, type Op, type RoundSummary } from '@gallery/shared';
import { clearCanvas, drawOps } from '../canvas/render';

const SHOWN = 6;
const MODE_LABEL: Record<string, string> = { paint: 'Paint War', enclose: 'Lasso' };

function paint(canvas: HTMLCanvasElement, ops: Op[], round: RoundSummary, scale: number) {
  const ctx = canvas.getContext('2d')!;
  clearCanvas(ctx);
  drawOps(ctx, ops, (pid) => round.players[pid]?.color ?? '#888888', scale);
}

function caption(r: RoundSummary): string {
  const w = r.winnerPid !== null ? r.players[r.winnerPid] : undefined;
  const time = new Date(r.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${MODE_LABEL[r.mode] ?? r.mode} · ${w ? `${w.name} won` : 'no winner'} · ${time}`;
}

function Thumb({ round, getRoundOps, onOpen }: { round: RoundSummary; getRoundOps: (i: number) => Promise<Op[]>; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    getRoundOps(round.idx).then((ops) => { if (live && ref.current) paint(ref.current, ops, round, 400 / CANVAS_W); });
    return () => { live = false; };
  }, [round, getRoundOps]);
  return (
    <div>
      <button className="mini-frame" onClick={onOpen} aria-label={caption(round)}>
        <canvas ref={ref} width={400} height={250} />
      </button>
      <div className="mini-label">{caption(round)}</div>
    </div>
  );
}

function Lightbox({ round, getRoundOps, onClose }: { round: RoundSummary; getRoundOps: (i: number) => Promise<Op[]>; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    getRoundOps(round.idx).then((ops) => { if (live && ref.current) paint(ref.current, ops, round, 1); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [round, getRoundOps, onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} />
        <div className="lightbox-caption">{caption(round)}</div>
      </div>
    </div>
  );
}

export function PastRounds({ history, getRoundOps }: { history: RoundSummary[]; getRoundOps: (idx: number) => Promise<Op[]> }) {
  const [open, setOpen] = useState<RoundSummary | null>(null);
  const recent = history.slice(-SHOWN).reverse();
  return (
    <aside className="past">
      <h2>Past Rounds</h2>
      {recent.length === 0 && <div className="mini-label">The wall is empty — for now.</div>}
      {recent.map((r) => (
        <Thumb key={r.idx} round={r} getRoundOps={getRoundOps} onOpen={() => setOpen(r)} />
      ))}
      {open && <Lightbox round={open} getRoundOps={getRoundOps} onClose={() => setOpen(null)} />}
    </aside>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors.

Manual check: set `ROUND_MINUTES = "1"` in `room/wrangler.toml` `[vars]` temporarily (or run `npx wrangler dev --var ROUND_MINUTES:1` from `room/`). Draw in a round, wait for the over phase: the winner overlay shows, the canvas wipes at the next round (modes alternate), and a thumbnail appears in "Past Rounds"; clicking it opens the lightbox; Escape closes it. Restore `ROUND_MINUTES` to `"30"`.

- [ ] **Step 3: Commit**

```bash
git add web/src/gallery/PastRounds.tsx
git commit -m "feat(web): past rounds wall with lightbox"
```

---

### Task 13: Free-tier check, README, and deploy configuration

**Files:**
- Create: `README.md`, `web/vercel.json`
- Modify (if limits require): `shared/src/constants.ts`, `web/src/canvas/PaintCanvas.tsx` (`FLUSH_MS`), `room/src/room.ts` (`FLUSH_EVERY_TICKS`)

**Interfaces:**
- Consumes: Cloudflare documentation via the `mcp__2cf86ef5-fbd8-4c33-800d-580810085826__search_cloudflare_documentation` tool (load with ToolSearch first).

- [ ] **Step 1: Verify current Cloudflare free-plan limits**

Search the Cloudflare docs for: Durable Objects free plan limits (requests/day, WebSocket message billing ratio, duration GB-s/day, SQLite rows written/read per day, SQLite storage). Record the actual numbers in the README "Free-tier budget" section. Then do this arithmetic and write it in the README:
- Messages per active drawer per second ≈ `1000 / FLUSH_MS` stroke batches (≈15) up to the engine rate limit (40/s).
- Fan-out: each stroke batch is sent to N−1 other sockets; confirm how outgoing messages are billed.
- Estimated messages for e.g. 6 people drawing 50% of the time for 8 h/day.

If the estimate exceeds a limit, raise `FLUSH_MS` (e.g. 66 → 100) and note it. Do not change anything else unless the numbers demand it.

- [ ] **Step 2: Write `web/vercel.json`**

```json
{
  "installCommand": "cd .. && npm install",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

- [ ] **Step 3: Write `README.md`**

````markdown
# Canvas Gallery

A shared drawing canvas hung in a virtual art gallery. Everyone gets a color, sees live cursors, and fights for territory. Modes rotate every 30 minutes (Paint War, Lasso).

## Local development

```bash
npm install
npm run dev:room     # game server on ws://localhost:8787/ws
npm run dev:web      # site on http://localhost:5173
npm test             # unit tests
npm run smoke -w room   # with dev:room running
```

Set `ROUND_MINUTES=1` (`npx wrangler dev --var ROUND_MINUTES:1` in `room/`) to watch rounds change quickly.

## Deploy (all free tiers)

1. **Game server (Cloudflare):** create a free Cloudflare account, then
   ```bash
   cd room
   npx wrangler login
   npx wrangler deploy
   ```
   Note the printed URL, e.g. `https://canvas-gallery-room.<you>.workers.dev`. The WebSocket URL is `wss://canvas-gallery-room.<you>.workers.dev/ws`.
   Optional password: `npx wrangler secret put ROOM_PASSWORD`.
2. **Website (Vercel):** push this repo to GitHub and import it in Vercel with **Root Directory = `web`**, and keep "Include source files outside of the Root Directory" enabled. Add the environment variable `VITE_ROOM_URL` = the `wss://…/ws` URL above. Deploy.
3. Share the Vercel URL with your coworkers.

## Free-tier budget

<fill in the verified numbers from Step 1 here, with the date you checked>

## How it works

- `room/` — authoritative game engine (`GameEngine`) wrapped in one Durable Object. State is persisted to SQLite every ≤10 s; the round clock is derived from wall time and an alarm fires at each phase change.
- `web/` — React app. The canvas is a replay of server ops; your own strokes draw instantly and are confirmed by the server.
- Adding a mode: add an entry to `MODES` in `room/src/game/modes.ts` and its id to `ModeId` and `MODE_ORDER` in `shared/`.
````

Replace the `<fill in …>` line with the real numbers gathered in Step 1 (no placeholder may remain).

- [ ] **Step 4: Final verification**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: all suites pass.
Run: `npm run build -w web`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: README, Vercel config, free-tier budget"
```

- [ ] **Step 6: Hand off deployment to the user**

The user runs `wrangler login`/`wrangler deploy` and the Vercel import themselves (no credentials are handled by the assistant). Offer to walk through it and to verify the deployed `/health` endpoint and a live round change.
