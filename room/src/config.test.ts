import { describe, it, expect } from 'vitest';
import { engineConfig } from './config';
import { ROUND_MS, OVER_MS } from '@gallery/shared';

describe('engineConfig', () => {
  it('uses the default round length when ROUND_MINUTES is missing or invalid', () => {
    for (const v of [undefined, '', 'abc', '0', '-3']) {
      expect(engineConfig({ ROUND_MINUTES: v }).roundMs).toBe(ROUND_MS);
    }
  });

  it('reads the round length from ROUND_MINUTES', () => {
    expect(engineConfig({ ROUND_MINUTES: '2' })).toMatchObject({ roundMs: 120_000, overMs: OVER_MS });
  });

  it('shrinks the over phase for very short test rounds', () => {
    expect(engineConfig({ ROUND_MINUTES: '0.5' })).toMatchObject({ roundMs: 30_000, overMs: 7_500 });
  });

  it('never pins a cyclic mode order, so the random no-repeat schedule is used', () => {
    expect('order' in engineConfig({ ROUND_MINUTES: '2' })).toBe(false);
    expect(engineConfig({}).order).toBeUndefined();
  });

  it('passes the room password through', () => {
    expect(engineConfig({ ROOM_PASSWORD: 'x' }).password).toBe('x');
    expect(engineConfig({}).password).toBe('');
  });
});
