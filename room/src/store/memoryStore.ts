import type { Op, RoundSummary } from '@gallery/shared';
import type { Meta, Store } from './store';

export class MemoryStore implements Store {
  meta: Meta | null = null;
  chunks = new Map<string, Op[]>();
  summaries = new Map<number, RoundSummary>();
  writes = 0;

  loadMeta() { return this.meta ? structuredClone(this.meta) : null; }
  saveMeta(m: Meta) { this.writes++; this.meta = structuredClone(m); }

  loadOpChunks(roundIdx: number): Op[] {
    const keys = [...this.chunks.keys()]
      .filter((k) => k.startsWith(`${roundIdx}:`))
      .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
    return keys.flatMap((k) => structuredClone(this.chunks.get(k)!));
  }
  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]) {
    this.writes++;
    this.chunks.set(`${roundIdx}:${chunk}`, structuredClone(ops));
  }

  saveSummary(s: RoundSummary) { this.summaries.set(s.idx, structuredClone(s)); }
  loadHistory(limit: number): RoundSummary[] {
    return [...this.summaries.values()].sort((a, b) => a.idx - b.idx).slice(-limit);
  }
  pruneBefore(roundIdx: number) {
    for (const k of [...this.chunks.keys()]) if (Number(k.split(':')[0]) < roundIdx) this.chunks.delete(k);
    for (const i of [...this.summaries.keys()]) if (i < roundIdx) this.summaries.delete(i);
  }
}
