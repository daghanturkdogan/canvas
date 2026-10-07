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
