import { describe, it, expect } from 'vitest';
import { REPLACED, reconnectDelay, shouldReconnect } from './reconnect';

describe('shouldReconnect', () => {
  it('does not reconnect a tab the server replaced with a newer one (two tabs would fight forever)', () => {
    expect(shouldReconnect(REPLACED)).toBe(false);
  });

  it('reconnects after every other kind of close', () => {
    for (const reason of ['', 'going away', 'internal error']) expect(shouldReconnect(reason)).toBe(true);
  });
});

describe('reconnectDelay', () => {
  it('backs off from half a second up to a 5 second cap', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });
});
