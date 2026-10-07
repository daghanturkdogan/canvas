import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ClientMsg, Op, ServerMsg } from '@gallery/shared';
import { initialState, reduce, type RoomState } from '../state/roomReducer';
import { OpLog } from '../canvas/opLog';
import { reconnectDelay, shouldReconnect } from './reconnect';

interface Opts { url: string; clientId: string; name: string | null; password?: string }

export function useRoom({ url, clientId, name, password }: Opts) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [epoch, setEpoch] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<(m: ServerMsg) => void>());
  const pending = useRef(new Map<number, (ops: Op[]) => void>());
  const cache = useRef(new Map<number, Op[]>());
  const opLog = useRef(new OpLog());

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
        opLog.current.apply(msg);
        dispatch({ type: 'server', msg, localNow: Date.now() });
        listeners.current.forEach((fn) => fn(msg));
      };
      ws.onclose = (ev) => {
        if (closed) return;
        if (!shouldReconnect(ev.reason)) {
          dispatch({ type: 'conn', conn: 'replaced' });
          return;
        }
        dispatch({ type: 'conn', conn: 'closed' });
        retry = setTimeout(connect, reconnectDelay(attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [url, clientId, name, password, epoch]);

  /** Play in this tab again after another tab took over. */
  const takeOver = useCallback(() => setEpoch((e) => e + 1), []);

  return { state: state as RoomState, send, subscribe, getRoundOps, opLog: opLog.current, takeOver };
}
