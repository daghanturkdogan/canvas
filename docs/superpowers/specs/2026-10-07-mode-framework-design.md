# Mode Framework (Step A) — Design Spec

Date: 2026-10-07
Builds on: `2026-10-07-canvas-gallery-design.md` (the shipped v1). Where this spec disagrees with v1, this spec wins.

## Goal

Turn the two hard-coded modes into a small framework so many more modes (and later powerups) can be added by writing one definition and one rules file each. Ship it with 1-minute rounds, a how-it-works screen, and one new mode (Splat) that proves the framework.

## Roadmap (separate specs, built in this order)

- **A. Framework (this spec):** per-mode brush, scoring, stroke filtering, erase strokes, mode state, overlay layer, how-it-works screen, 1-minute rounds, Splat.
- **B. Simpler modes:** Hot Zones, Shrinking Zone, King of the Hill, Capture the Flag, Fog of War, Eraser Wars, Team Tug-of-War.
- **C. Powerups:** random pickups on the canvas (bigger brush, delete a random player's ink, speed, shield, color swap, ...), usable in every mode with per-mode opt-out.
- **D. Harder modes:** Copycat (trace a template, scored by similarity) and Hot Potato.

Final rotation after all steps: Paint War, Splat, Lasso, Hot Zones, King of the Hill, Capture the Flag, Fog of War, Eraser Wars, Team Tug-of-War, Shrinking Zone, Copycat, Hot Potato (order to be settled in later specs).

## Decisions

- Round length default **1 minute** (`ROUND_MS = 60_000`, `wrangler.toml` `ROUND_MINUTES = "1"`). The last 10 s stay the "over" phase, leaving ~50 s of drawing.
- Rotation in step A: `paint`, `splat`, `enclose`, repeat (3-minute cycle).
- The how-it-works screen is shown **inside the existing 10 s over phase**, next to the winner card, as an "Up next" panel for the following mode. No extra phase, no lost drawing time. A "?" button on the plaque shows the current mode's how-to at any time.
- A mode is **shared data** (name, rules, how-to lines, brush radius, optional overlay function) read by server and browser, plus **server-only rules** (stroke filter, fill logic, scoring, per-round state).
- Erasing is a stroke with `pid: 0` ("nobody"): the grid sets its cells to 0 and the browser paints it in paper color. Replays and past rounds therefore show erasing correctly.
- Brush radius is per mode and comes from the shared definition; past-round replays look it up from the round's mode id.
- State from the 30-minute era is discarded on first start after deploy (the engine's existing "round index changed" path finalizes and prunes it).

## Shared package (`shared/`)

- `ModeId = 'paint' | 'splat' | 'enclose'` (extended by later steps).
- `ModeDef { id: ModeId; name: string; rules: string; howTo: string[]; brush: number }` and `MODE_DEFS: Record<ModeId, ModeDef>`.
  - `paint`: brush 6; `splat`: brush 20; `enclose`: brush 6.
  - `howTo` has 3–4 short lines per mode.
- `MODE_ORDER = ['paint', 'splat', 'enclose']`.
- `ModeState = Record<string, unknown>`; messages carrying it are typed with `ModeState | null`.
- `RoundInfo` gains `brush: number`, `howTo: string[]`, and `next: { mode: ModeId; name: string; rules: string; howTo: string[]; brush: number }`.
- `OverlayShape = { kind: 'circle'; x; y; r; label?: string; tone: 'zone' | 'flag' | 'hill' } | { kind: 'ring'; x; y; r }` and `overlayShapes(def, round, now, state): OverlayShape[]` which returns `[]` for the three step-A modes (later modes add real overlays).
- New server message: `{ t: 'mode-state'; idx: number; state: ModeState | null }`; `welcome` also carries `modeState`.
- `ROUND_MS = 60_000`.

## Room (`room/`)

- `Mode` (server rules) gains optional members: `erases?: boolean`, `init?(ctx: { roundIdx: number }): ModeState | null`, `filterPoints?(ctx): Pt[]`, `score?(ctx: { grid; players }): Record<number, number>`. Existing `onPoints` stays.
- Engine uses `MODE_DEFS[mode].brush` for every stamp (live and in restore replay).
- Engine uses `mode.score ?? grid.shares()` for the `scores` message and for picking the winner.
- If `mode.erases`, stroke ops are stored with `pid: 0` and stamped with owner 0 (cells cleared); player stats still accrue to the drawer.
- If `filterPoints` is present, rejected points are dropped before stamping; a stroke continues as a new op after a gap.
- Mode state: engine holds `modeState`; `init` runs at round start; `setModeState(next)` marks it dirty and `tick()` emits one `mode-state` message per change. It is persisted in `Meta` (`modeState`) and sent in `welcome`.
- `GameEngine` accepts an optional `modes` registry in its config so tests can inject fake modes (erasing, filtering, scoring, state).
- `wrangler.toml`: `ROUND_MINUTES = "1"`.

## Web (`web/`)

- `render.ts`: `drawSegment`/`drawOps` take the brush radius; `pid 0` draws in paper color.
- `PaintCanvas` uses `round.brush` for local drawing; `PastRounds` uses `MODE_DEFS[summary.mode].brush`.
- `OpLog` is unchanged apart from handling `pid: 0` like any other stroke.
- `roomReducer` stores `modeState` from `welcome` and `mode-state`.
- New `OverlayLayer` component: an absolutely positioned SVG above the canvas that renders `OverlayShape[]` (circles with optional labels; a ring as a dimmed area outside the circle). It re-renders from the synced clock.
- `RoundOver` shows two panels: the winner card and "Up next" (mode name, rules, how-to list, brush preview).
- `Plaque` gets a "?" button that toggles the current mode's how-to list.

## Testing (failing test first for each)

- Shared: `MODE_DEFS` has an entry for every id in `MODE_ORDER`; every def has non-empty name/rules/howTo and a positive brush; `overlayShapes` returns `[]` for the step-A modes; round info includes the next mode.
- Engine (with injected fake modes where needed): Splat's stamp covers more cells than Paint's for the same stroke; a fake erasing mode clears cells and stores `pid: 0`; a fake filtering mode drops points and splits the stroke; a fake scoring mode changes `scores` and the winner; `init` state is delivered in `welcome`, a change emits exactly one `mode-state`, and the state survives a restart.
- Web: `OpLog` keeps `pid: 0` strokes; reducer handles `mode-state`.
- Browser check with 1-minute rounds: rotation Paint War → Splat → Lasso, Splat blobs are visibly bigger on both viewers, the "Up next" panel appears in the over phase and matches the following round, the "?" popover opens.

## Out of scope for step A

Any mode beyond Splat, powerups, teams, templates, and per-player abilities.

## Free-tier note

Round and mode changes happen 1,440 times a day, each costing a handful of SQLite writes plus two alarms. That is about 7–15k rows/day against the 100,000/day limit. Message volume is unchanged by modes. The README's budget table must be updated for 1-minute rounds.

## Assumptions

1. 50 s of drawing per round is acceptable; the 10 s over phase is kept as is.
2. Past-round history of 50 rounds now covers about 50 minutes.
3. Dropping the 30-minute-era history on first deploy is fine.
