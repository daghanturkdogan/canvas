# Canvas Gallery — Design Spec

Date: 2026-10-07

## Goal

A free-to-host, realtime multiplayer drawing site for a group of coworkers to have fun. Everyone draws on one shared canvas hung in a virtual art gallery. Each person gets a distinct color, sees live cursors, and competes on a territory leaderboard. Game modes rotate every 30 minutes.

## Decisions (from brainstorming)

- **One shared canvas** (not many). Drawing competition (separate per-person pieces) is a later version.
- **Smooth freehand painting**, fixed brush size, fixed canvas size (~1600x1000).
- **Rotating modes every 30 min**, canvas **wipes each round**; finished canvases are saved to a past-rounds gallery.
  - **Paint:** score = share of canvas in your color.
  - **Enclose:** draw a line; closing a loop fills the interior with your color; score = territory.
- **Main leaderboard = territory.** Ink spent, time drawing, and overdraw are tracked in the background (not displayed in v1). A persistent rounds-won tally is shown.
- **Identity:** type a display name, no login. Server assigns the next free color from a curated palette; remembered in the browser. Optional shared room password (off by default).
- **Hosting (free):** React site on Vercel Hobby; game server on a Cloudflare Worker + Durable Object (SQLite-backed) on the free plan. Vercel cannot hold WebSockets or run timers, so it only serves the static site.
- **Look:** art canvas in a framed gallery scene, built with CSS/SVG (no heavy 3D).

## Architecture

Single TypeScript repo:

- `web/` — React + TypeScript (Vite) site, deployed to Vercel. Gallery scene, canvas, cursors, leaderboard, name entry, past-rounds gallery.
- `room/` — Cloudflare Durable Object with WebSocket endpoint. Authoritative game server: canvas state, players, scores, round clock, gallery storage.
- `shared/` — message protocol and types used by both.

The room is the source of truth. Clients send inputs (pen down/move/up); the room validates, applies, and broadcasts. Clients never decide scores or ownership.

### Modes as plugins

Each mode implements an interface: apply input to canvas/ownership, compute territory and scores, provide rules text. The room runs the current mode and swaps it on the clock. New modes = one new file.

### Round clock

Mode is a pure function of wall time: `modes[floor(now / roundLength) % modes.length]`. The room sets a Durable Object alarm at each boundary to finalize the round: save canvas image and results to the gallery, broadcast a "Round over" screen (~10 s), wipe the canvas, start the next mode. Round length is a config value (default 30 min). The final 10 s of each round is an "over" phase: drawing is rejected and the winner is announced; finalization (save to gallery, winner) happens when the over phase begins, and the next round starts wiped at the boundary, so the total stays 30 minutes.

### Canvas state

Fixed-size raster (~1600x1000) plus a low-resolution ownership grid so territory counts are cheap. The browser draws strokes locally immediately and reconciles with the room's version.

## Drawing and sync

- Fixed round brush in the player's color.
- Client sends pen paths as small batches, throttled to ~15/s, and draws locally at once. Room applies the same stroke to the canonical canvas and broadcasts.
- Late joiners/reconnects receive a compressed PNG snapshot plus strokes since.
- Cursors: each drawing player's cursor is shown with their color and name, smoothed client-side, hidden ~2 s after their last point. Cursor position is derived from stroke points (no separate cursor message), which also saves free-tier traffic.
- Later strokes overwrite earlier ones (territory is contestable).

## Scoring

- **Paint:** share of ownership grid per player.
- **Enclose:** when a player's line crosses itself or their own earlier line to form a closed loop, the room flood-fills the interior with their color. Loops can only close against the player's own line. Fills covering more than ~50% of the canvas are rejected (value tuned during build). Filled area counts as territory.
- **Round end:** highest territory share wins. Rounds-won tally persists across rounds.
- Background stats per player: ink spent, drawing time, overdraw count.

## Gallery UI

- Dark warm museum room: wall, soft spotlights, floor reflection. Canvas in an ornate frame with a brass plaque showing round, mode name, and countdown.
- Leaderboard as a wall placard beside the painting.
- Past rounds as smaller framed paintings (side wall/scrollable row), click to enlarge.
- CSS + SVG, performant on any laptop; works at laptop widths (mobile is not a goal for v1).

## Free-tier considerations

Cloudflare free plan has daily request limits, with WebSocket messages counted at a discounted rate. Cursor and stroke updates are batched and throttled to stay within limits. Current limits to be verified from Cloudflare docs during planning; if tight, reduce update rate rather than upgrade.

## Testing and delivery

- Game logic (modes, scoring, flood-fill, round clock) is plain TypeScript with unit tests, no browser or network.
- A script simulates several clients against the room for a smoke test.
- Deploy: `web/` to Vercel, `room/` to Cloudflare via `wrangler`. User logs in to both accounts; no credentials are handled by the assistant.

## Assumptions

1. Password gate is off by default.
2. Round length is configurable; default 30 minutes.
3. Redeploying the room resets live state; saved gallery images persist.
4. Out of scope for v1: per-person drawing competition, displaying the background stats, mobile layout.
