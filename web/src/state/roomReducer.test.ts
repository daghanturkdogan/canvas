import { describe, it, expect } from 'vitest';
import { initialState, reduce } from './roomReducer';
import type { RoundInfo, ServerMsg } from '@gallery/shared';

const round: RoundInfo = {
  idx: 5, mode: 'paint', modeName: 'Paint War', rules: 'r', howTo: ['a'], brush: 6, phase: 'playing',
  startsAt: 0, overAt: 900, endsAt: 1000,
  next: { mode: 'splat', name: 'Splat', rules: 'r', howTo: ['b'], brush: 20 },
};
const welcome: ServerMsg = {
  t: 'welcome', serverNow: 10_000, you: 3,
  players: [{ pid: 3, name: 'Ann', color: '#fff', online: true, wins: 0 }],
  round, winnerPid: null, ops: [], shares: { 3: 0.1 }, history: [], modeState: null,
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
});
