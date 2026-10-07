import type { ModeId, ServerMsg } from '@gallery/shared';
import type { LoopTrail } from './loops';
import type { ModeEntry } from './modes';

export interface PlayerStats { ink: number; drawMs: number; overdraw: number }

export interface PlayerState {
  clientId: string;
  slot: number;
  name: string;
  color: string;
  online: boolean;
  lastSeen: number;
  wins: number;
  stats: PlayerStats;
  trail: LoopTrail;
  curStroke: string | null;
  curOpId?: string | null;
  lastMsgAt: number;
  tokens: number;
  tokensAt: number;
}

export type Target = 'all' | { only: string } | { except: string };
export interface Outbound { to: Target; msg: ServerMsg }

export interface EngineConfig {
  roundMs: number;
  overMs: number;
  /** Cyclic mode order (tests). Omit to use the random no-repeat schedule. */
  order?: readonly ModeId[];
  password: string;
  /** Test hook: replaces the built-in mode registry. */
  registry?: Record<string, ModeEntry>;
}
