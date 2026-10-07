import type { Op, RoundSummary } from '@gallery/shared';

export interface PersistedPlayer {
  clientId: string;
  slot: number;
  name: string;
  color: string;
  wins: number;
  lastSeen: number;
  stats: { ink: number; drawMs: number; overdraw: number };
}

export interface Meta {
  roundIdx: number;
  finalized: boolean;
  players: PersistedPlayer[];
}

export interface Store {
  loadMeta(): Meta | null;
  saveMeta(m: Meta): void;
  loadOpChunks(roundIdx: number): Op[];
  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]): void;
  saveSummary(s: RoundSummary): void;
  loadHistory(limit: number): RoundSummary[];
  pruneBefore(roundIdx: number): void;
}
