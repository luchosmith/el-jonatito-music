import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export type Param = SQLInputValue;

/** Thin typed wrapper around node:sqlite (built into Node >= 22.13, no native build step). */
export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.raw.exec(fs.readFileSync(schemaFile, 'utf8'));
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  /** Remove every row (used by tests). */
  wipe() {
    this.raw.exec('DELETE FROM songs; DELETE FROM sqlite_sequence;');
  }

  close() {
    this.raw.close();
  }
}
