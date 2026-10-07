# Modes Batch B Implementation Plan

> Executed natively (user chose inline execution and asked not to wait). TDD per task: write the failing test, watch it fail, implement, watch it pass, commit locally. Do not push.

**Goal:** Add 7 modes (Hot Zones, Shrinking Zone, King of the Hill, Capture the Flag, Fog of War, Eraser Wars, Team Tug-of-War), 2-minute rounds, and a random no-repeat rotation.

**Spec:** `docs/superpowers/specs/2026-10-07-modes-batch-b-design.md` (rules, thresholds, state shapes and file list live there; this plan sequences the work).

## Global Constraints

- `ROUND_MS = 120_000`, `wrangler.toml` `ROUND_MINUTES = "2"`, over phase 10 s.
- Brushes: paint 6, splat 20, hotzones 6, hill 6, enclose 6, ctf 6, fog 6, eraser 6 (erase 20), shrink 6, teams 6.
- Team shades are fixed constants; ink slots stay 1..24; erase strokes use `pid 0`.
- The engine must keep working with an injected `registry` and an optional cyclic `order` (existing tests rely on both).
- `npm run typecheck` and `npm test` green at the end of every task except the shared-types hand-off noted in Task 1.

## Review Focus

1. Schedule never repeats a mode back to back, including across bag boundaries, and is identical for server and clients. (Task 1 tests.)
2. Shrinking Zone never paints outside the ring and never connects points across a gap. (Task 3.)
3. A restart mid-round keeps hill points / flag / teams, and rebuilds the grid with the erase brush for `pid 0` ops. (Tasks 3, 4.)
4. Teams: fewer than 6 players gives 2 teams; a late joiner lands in the smallest team; colors differ per team. (Task 4.)
5. Fog hides other players' ink and scores only while playing, never in the over phase. (Task 5, browser check.)

---

### Task 1: Shared — schedule, zones, teams, defs, protocol

**Files:** create `shared/src/schedule.ts`, `shared/src/zones.ts`, `shared/src/teams.ts`; modify `constants.ts`, `protocol.ts`, `modes.ts`, `index.ts`; tests `schedule.test.ts`, `zones.test.ts`, `teams.test.ts`, update `modes.test.ts`, `clock.test.ts` if affected.

- [ ] Write failing tests: `bagOrder`/`scheduledMode` (each bag a permutation of all modes; 2,000 consecutive rounds have no adjacent repeats; deterministic; `nextModeInfo(idx)` equals `scheduledMode(idx+1)`), zones (`hotZones` 3 circles inside the canvas margin, deterministic, non-overlapping; `ringAt` r 960 at start → 150 at `overAt`, monotonic, clamped; `hillAt` constant within a 10 s step and different across steps; `flagAt` deterministic per `(idx, n)`), teams (`teamCountFor`: 0–5 → 2, 6–8 → 2, 9–11 → 3, 12+ → 4; 6 shades per team).
- [ ] Implement: `ModeId` adds `hotzones | hill | ctf | fog | eraser | shrink | teams`; `MODE_ORDER` = all 10 ids; `ROUND_MS = 120_000`; `MODE_DEFS` for the 7 new modes (names, rules, 3–4 how-to lines, brush, `fog: true` for fog, `eraseBrush: 20` for eraser, overlay functions for hotzones/shrink/hill/ctf); `PlayerInfo.team?`, stroke `erase?`; `nextModeInfo(idx)` uses `scheduledMode`; `modeForRound` stays for cyclic callers.
- [ ] Commit `feat(shared): ...`. Room/web typecheck may be red until Task 2.

### Task 2: Room framework extensions

**Files:** modify `room/src/game/modes.ts` (types), `types.ts`, `engine.ts`; tests in `engine.test.ts`.

- [ ] Failing tests with injected fake modes: `onPoints`/`filterPoints`/`score` receive `now`, `round`, `api`; `onFill` called after a fill with the polygon; `onJoin` called on first join and can set state; `init` receives online players; `playerInfo` override reaches `welcome` and `players`, and changing state re-emits `players`; `allowsErase` honors the stroke `erase` flag (and ignores it when not allowed); erase ops are stamped with `def.eraseBrush` and rebuilt with it after a restart; schedule: engine without `order` follows `scheduledMode`.
- [ ] Implement as in the spec; `EngineConfig.order` optional; `entry(idx)` uses `order` cyclic if given else `scheduledMode`.
- [ ] Commit.

### Task 3: Room modes — Hot Zones, Shrinking Zone, King of the Hill, Capture the Flag

**Files:** `room/src/game/modes.ts`, `room/src/game/modes.test.ts` (or `modes.rules.test.ts`).

- [ ] Failing tests through the real registry: hotzones weighted score; shrink drops points outside `ringAt` and splits strokes; hill: points only inside the current hill, score blend, state persists across restart; ctf: loop around the flag captures it, `n` increments, flag moves, score bonus, no capture when the loop misses.
- [ ] Implement the four rules and register them in `REGISTRY`.
- [ ] Commit.

### Task 4: Room modes — Fog (server), Eraser Wars, Team Tug-of-War

- [ ] Failing tests: eraser mode accepts `erase: true` strokes (pid 0, clears ownership, 20 brush) and ignores the flag in Paint War; teams: 8 online → 2 teams balanced, 12 → 4, late joiner in smallest team, team score equal for members and winner picked by team, colors differ between teams and come from `TEAMS`, `players` re-emitted when teams are created, summary colors are team shades.
- [ ] Implement `fog` (paint behavior), `eraser`, `teams` and register them.
- [ ] Commit.

### Task 5: Web — filter, erase toggle, fog, teams UI

- [ ] Failing tests: `drawOps` per-op radius; `groupByTeam` helper; OpLog erase (already covered); `teamLabel(winner)` helper.
- [ ] Implement: `drawOps` radius function; `PaintCanvas` `allow` + erase mode (Shift / toggle) sending `erase`; `FogLayer`; `CursorLayer` hidden prop; `Leaderboard` team grouping and fog hiding; `RoundOver` team label; eraser toggle button; wire everything in `Gallery`; `wrangler.toml` `ROUND_MINUTES = "2"`.
- [ ] Typecheck, build, commit.

### Task 6: Integration

- [ ] README (modes list, 2-minute rounds, free-tier arithmetic for 720 round changes/day), full tests + typecheck + build + smoke test.
- [ ] Browser verification against `wrangler dev` + Vite: overlay for hotzones/shrink/hill/ctf visible; Shrinking ring blocks drawing outside; fog hides other ink and reveals it in the over phase; eraser toggle erases; teams show grouped leaderboard and team colors; "Up next" matches the actual next mode over a full rotation (use `ROUND_MINUTES` small for the check).
- [ ] Commit; final self-review; report rulings and deferred minors. Do not push.
