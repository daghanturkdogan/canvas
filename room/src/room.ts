import type { ClientMsg } from '@gallery/shared';
import { engineConfig } from './config';
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
      this.engine = new GameEngine(engineConfig(env), new SqlStore(ctx.storage.sql), Date.now());
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
