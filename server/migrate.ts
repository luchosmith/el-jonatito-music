// Schema versions (PRAGMA user_version). A new database gets schema.sql as it is; an older one is
// upgraded step by step, after a backup copy is made next to it.
// v1 (0 on disk): the clone of El Jonatito's 🎧 Music: one songs table, every file in uploads/songs.
// v2: the library: roots (a NAS folder, the uploads folder) and a row per audio file with all its metadata.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';

export const SCHEMA_VERSION = 2;

const schemaFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

const hasTable = (db: Db, name: string) => !!db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name);

/** Brings the database up to SCHEMA_VERSION. Returns the backup file when an upgrade happened. */
export function migrate(db: Db, file: string): string | null {
  const from = db.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
  if (from === SCHEMA_VERSION) return null;
  if (from > SCHEMA_VERSION) throw new Error(`The database is schema v${from}, newer than this app (v${SCHEMA_VERSION})`);
  if (from === 0 && !hasTable(db, 'songs')) {
    db.tx(() => {
      db.raw.exec(fs.readFileSync(schemaFile, 'utf8'));
      ensureUploadsRoot(db);
      db.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return null;
  }
  let backup: string | null = null;
  if (file !== ':memory:') {
    backup = `${file}.v${from || 1}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    db.raw.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }
  if (from < 2) db.tx(() => v1to2(db));
  db.raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return backup;
}

export function ensureUploadsRoot(db: Db): number {
  const r = db.get<{ id: number }>("SELECT id FROM roots WHERE kind = 'uploads'");
  return r ? r.id : db.run("INSERT INTO roots(kind, path, name, added_at) VALUES('uploads', NULL, 'Uploads', ?)", new Date().toISOString()).lastId;
}

/** v2: the songs so far all become the uploads root's, with what was known about them. */
function v1to2(db: Db) {
  db.raw.exec('ALTER TABLE songs RENAME TO songs_v1');
  db.raw.exec(fs.readFileSync(schemaFile, 'utf8'));
  const uploads = ensureUploadsRoot(db);
  db.run(
    `INSERT INTO songs(id, root_id, path, title, artist, cover, embedded_cover, source, hidden, normalized, added_at)
     SELECT id, ?, file, title, artist, cover, cover IS NOT NULL, source, hidden, normalized, added_at FROM songs_v1 ORDER BY id`,
    uploads,
  );
  db.raw.exec('DROP TABLE songs_v1');
}
