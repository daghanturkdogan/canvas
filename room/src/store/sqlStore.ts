import type { Op, RoundSummary } from '@gallery/shared';
import type { Meta, Store } from './store';

export class SqlStore implements Store {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS round_ops (round_idx INTEGER NOT NULL, chunk INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (round_idx, chunk))`,
    );
    sql.exec(`CREATE TABLE IF NOT EXISTS rounds (idx INTEGER PRIMARY KEY, json TEXT NOT NULL)`);
  }

  loadMeta(): Meta | null {
    const rows = this.sql.exec(`SELECT v FROM meta WHERE k = 'meta'`).toArray();
    return rows.length ? (JSON.parse(rows[0]!.v as string) as Meta) : null;
  }

  saveMeta(m: Meta): void {
    this.sql.exec(
      `INSERT INTO meta (k, v) VALUES ('meta', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(m),
    );
  }

  loadOpChunks(roundIdx: number): Op[] {
    const rows = this.sql.exec(`SELECT json FROM round_ops WHERE round_idx = ? ORDER BY chunk`, roundIdx).toArray();
    return rows.flatMap((r) => JSON.parse(r.json as string) as Op[]);
  }

  saveOpChunk(roundIdx: number, chunk: number, ops: Op[]): void {
    this.sql.exec(
      `INSERT INTO round_ops (round_idx, chunk, json) VALUES (?, ?, ?)
       ON CONFLICT(round_idx, chunk) DO UPDATE SET json = excluded.json`,
      roundIdx, chunk, JSON.stringify(ops),
    );
  }

  saveSummary(s: RoundSummary): void {
    this.sql.exec(`INSERT OR REPLACE INTO rounds (idx, json) VALUES (?, ?)`, s.idx, JSON.stringify(s));
  }

  loadHistory(limit: number): RoundSummary[] {
    const rows = this.sql.exec(`SELECT json FROM rounds ORDER BY idx DESC LIMIT ?`, limit).toArray();
    return rows.map((r) => JSON.parse(r.json as string) as RoundSummary).reverse();
  }

  pruneBefore(roundIdx: number): void {
    this.sql.exec(`DELETE FROM round_ops WHERE round_idx < ?`, roundIdx);
    this.sql.exec(`DELETE FROM rounds WHERE idx < ?`, roundIdx);
  }
}
