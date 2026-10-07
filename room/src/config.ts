import { OVER_MS, ROUND_MS } from '@gallery/shared';
import type { EngineConfig } from './game/types';

export interface RoomEnv { ROOM_PASSWORD?: string; ROUND_MINUTES?: string }

/**
 * Engine settings from the Worker environment. No cyclic `order` is set on purpose, so the
 * random no-repeat schedule from `@gallery/shared` decides which mode each round plays.
 */
export function engineConfig(env: RoomEnv): EngineConfig {
  const minutes = Number(env.ROUND_MINUTES);
  const roundMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : ROUND_MS;
  const overMs = Math.min(OVER_MS, Math.floor(roundMs / 4));
  return { roundMs, overMs, password: env.ROOM_PASSWORD ?? '' };
}
