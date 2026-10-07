# Modes Batch B — Design Spec

Date: 2026-10-07. Builds on `2026-10-07-mode-framework-design.md` (step A). Where this spec disagrees with earlier ones, this spec wins.

## Decisions (user-approved)

- **Round length 2 minutes** (`ROUND_MS = 120_000`, `ROUND_MINUTES = "2"`): ~110 s of drawing + 10 s winner/"Up next" phase.
- **Random rotation without repeats:** modes are shuffled in "bags". Each bag contains every mode exactly once in a seeded random order (seed = bag number, so it is deterministic and survives restarts and is identical on every client). The first mode of a bag is never the last mode of the previous bag. `scheduledMode(idx)` in `shared/` is the single source of truth; `nextModeInfo(idx)` uses it so the "Up next" panel always matches.
- **Teams scale with players:** at round start `teamCount = clamp(floor(onlineCount / 3), 2, 4)`. Players are dealt round-robin in a seeded random order; late joiners go to the smallest team. Team colors: 4 teams x 6 shades (warm/cool families). Team score = sum of its members' territory; every member gets the team's score, so the winner card shows "Team <name>".
- **Eraser Wars:** paint normally; hold **Shift** or use the on-screen **Eraser** toggle to erase with a wider brush (20 vs 6). Erase strokes are stored with `pid: 0`.
- **Fog of War** is client-only visually (own ink + a 150 px "lantern" around the cursor; everything revealed in the over phase; leaderboard hidden while playing; other cursors hidden). The server treats it as Paint War.
- Hill/flag scoring as proposed: Hill = 60% territory + 40% share of "hill points"; Flag = territory + 8% per capture.
- Rotation of all 10 modes: `paint, splat, hotzones, hill, enclose, ctf, fog, eraser, shrink, teams`.

## Mode rules

| id | name | rule |
|---|---|---|
| hotzones | Hot Zones | 3 circles (r 140), placed from the round index. Ground inside counts 5x. Score = weighted share `w_i / (cells + 4*zoneCells)`. Overlay: dashed zone circles labeled "5x". |
| shrink | Shrinking Zone | Ring centered (800, 500) shrinks linearly from r 960 to r 150 over the drawing time. Points outside are dropped (server `filterPoints`; browser stops drawing locally). Territory painted earlier still counts. Overlay: dimmed outside. |
| hill | King of the Hill | Hill circle (r 150) moves every 10 s to a seeded position. Each point painted inside the hill adds a hill point to that player (state `{ pts: {pid: n} }`). Score = `0.6*share + 0.4*(pts_i / totalPts)`. Overlay: green circle labeled "HILL". |
| ctf | Capture the Flag | Lasso rules plus a flag (r 70 marker) at `flagAt(roundIdx, n)`. A loop (fill) whose polygon contains the flag center captures it: `caps[pid]++`, `n++`, flag respawns. State `{ n, caps }`. Score = `share + 0.08*caps`. Overlay: white circle labeled "FLAG". |
| fog | Fog of War | Paint War scoring; client fog as above. |
| eraser | Eraser Wars | Paint War plus erase strokes. Score = territory. |
| teams | Team Tug-of-War | Paint War ink in team shades; scoring per team as above. State `{ teams: {pid: team}, count }`; `playerInfo` override supplies `team` and the team shade as `color`. |

## Framework additions (room)

- Hook contexts gain `now`, `round { idx, startsAt, overAt }`, and `api { state, setState(next) }`.
- New optional `Mode` members: `allowsErase`, `onFill(ctx)`, `onJoin(ctx)`, `playerInfo(info, ctx)`. `init` receives `{ roundIdx, players }` (online players); `score` receives `{ grid, players, state, roundIdx }`.
- When mode state changes and the mode has `playerInfo`, `tick()` also re-emits the `players` message so clients recolor.
- Engine stroke handling: `erase` flag honored only if `allowsErase`; erase ops use `def.eraseBrush` (ownership grid replay on restart uses it for `pid 0` ops).
- Round summaries record the colors shown that round (team shades) so past-round replays match.
- `EngineConfig.order` stays as an optional cyclic override (used by tests); production passes none and uses `scheduledMode`.

## Shared additions

- `ModeId` gains the 7 new ids; `MODE_ORDER` lists all 10.
- `ModeDef` gains optional `eraseBrush`, `fog`.
- `PlayerInfo.team?: number`; `ClientMsg` stroke gains `erase?: boolean`.
- `shared/src/zones.ts`: `seededRng`, `hotZones(idx)`, `ringAt(round, now)`, `hillAt(idx, startsAt, now)`, `flagAt(idx, n)`, `inCircle`.
- `shared/src/teams.ts`: `TEAMS` (name + 6 shades each), `teamCountFor(online)`.
- `scheduledMode`, `bagOrder` in `shared/src/schedule.ts`.

## Web additions

- `PaintCanvas`: optional `allow(x, y)` filter (Shrinking Zone); erase mode (Shift or toggle) sending `erase: true`, drawing paper color with the erase brush.
- `drawOps` takes a per-op radius function so `pid 0` ops use the erase brush.
- `FogLayer` component; `CursorLayer` and `Leaderboard` honor fog.
- `Leaderboard` groups by team when players have `team`; `RoundOver` shows "Team X" for team winners.
- Eraser toggle button shown when the mode has `eraseBrush`.

## Testing (failing test first)

Shared: bag schedule (each mode once per bag, no repeat across bags over 2,000 rounds, deterministic), zones determinism and bounds, ring monotonic shrink, hill position changes every 10 s, team count thresholds. Room (engine with injected or real modes): hotzones weighted score, shrink filter drops outside points, hill points and score blend, ctf capture and respawn, eraser erase flag only when allowed and `pid 0` stored with the erase brush (also across restart), teams assignment sizes/late joiner/score/colors/players re-emit. Web: OpLog with erase, leaderboard grouping helper, schedule-driven round info.

## Out of scope

Powerups, Copycat, Hot Potato, per-player abilities.
