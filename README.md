# Canvas Gallery

A shared drawing canvas hung in a virtual art gallery. Everyone gets a color, sees live cursors, and fights for territory. Rounds last 1 minute (about 50 s of drawing plus a 10 s winner screen that also explains the next mode). Modes rotate: Paint War, Splat, Lasso.

## Local development

```bash
npm install
npm run dev:room     # game server on ws://localhost:8787/ws
npm run dev:web      # site on http://localhost:5173 (or the next free port)
npm test             # unit tests
npm run smoke -w room   # with dev:room running
```

Rounds are 1 minute by default. Change `ROUND_MINUTES` in `room/wrangler.toml` (or `npx wrangler dev --var ROUND_MINUTES:5`) to use a different length.

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

Limits for the Cloudflare Workers **Free** plan, checked against the Cloudflare documentation on 2026-10-07 (re-check before relying on them):

| Resource | Free limit | How this app uses it |
|---|---|---|
| Durable Object requests | 100,000 / day | Each client message counts as 1/20 of a request (20:1 WebSocket ratio, incoming messages only). |
| Durable Object duration | 13,000 GB-s / day | One 128 MB object kept active all day ≈ 10,800 GB-s. It is active while any browser tab is connected. |
| SQLite rows read | 5 million / day | Only on restart and when opening past rounds. |
| SQLite rows written | 100,000 / day | Saved at most every 10 s, only changed 100-op chunks; each alarm and each delete counts as a row. |
| SQLite storage | 5 GB | Last 50 rounds only (older ones are pruned). |

Exceeding any one limit makes that kind of operation fail until 00:00 UTC.

**Round changes.** With 1-minute rounds there are about 1,440 round changes a day. Each costs a handful of SQLite writes (round state, finished-round summary, old-round cleanup) plus two alarm writes, roughly 7–15k rows/day in total against the 100,000/day limit. The past-rounds wall keeps the last 50 rounds, so it reaches back about 50 minutes.

**Message budget.** A drawing client sends about 10 stroke batches per second (`FLUSH_MS = 100` in `web/src/canvas/PaintCanvas.tsx`). Example heavy day: 10 people drawing half the time for 8 hours = 10 × 0.5 × 8 × 3600 × 10 ≈ 1.44 M messages ÷ 20 ≈ **72,000 requests**. At the original 15/s the same day would be about 108,000 and exceed the cap, which is why the rate was lowered. If you hit the limit, raise `FLUSH_MS` further (the engine already rate-limits each player to about 40 messages/s).

## How it works

- `room/` — authoritative game engine (`GameEngine`) wrapped in one Durable Object. State is persisted to SQLite every ≤10 s; the round clock is derived from wall time and an alarm fires at each phase change.
- `web/` — React app. The canvas is a replay of server ops; your own strokes draw instantly and are confirmed by the server.
- Adding a mode: add its definition (name, rules, how-to lines, brush size, optional overlay) to `MODE_DEFS` in `shared/src/modes.ts`, its server rules (stroke filter, scoring, erase, per-round state) to `REGISTRY` in `room/src/game/modes.ts`, and its id to `ModeId` and `MODE_ORDER` in `shared/`.
