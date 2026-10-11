// Copies the song library from an El Jonatito data folder: its songs (already evened out), their cover
// art and their hidden flags. El Jonatito is only read: its database is copied to a temp folder first.
// Songs already here (by original file name) are skipped, so it can be run again.
// Usage: npm run music:from-jonatito -- <el-jonatito data folder, e.g. ~/el-jonatito/src/data>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, type Config } from './config.ts';
import { Db } from './db.ts';
import { ensureUploadsRoot } from './migrate.ts';

interface SourceSong { title: string; artist: string | null; file: string; cover: string | null; source: string | null; hidden: number; normalized: number; added_at: string }

export function importFromJonatito(db: Db, cfg: Config, srcDataDir: string): { added: number; skipped: number } {
  const srcDb = path.join(srcDataDir, 'jonatito.sqlite');
  if (!fs.existsSync(srcDb)) throw new Error(`No jonatito.sqlite in ${srcDataDir}`);
  // A snapshot of the database (with its write-ahead log), so nothing in El Jonatito is opened for writing.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-music-'));
  for (const ext of ['', '-wal']) if (fs.existsSync(srcDb + ext)) fs.copyFileSync(srcDb + ext, path.join(tmp, 'jonatito.sqlite' + ext));
  const src = new DatabaseSync(path.join(tmp, 'jonatito.sqlite'));
  const rows = src.prepare('SELECT title, artist, file, cover, source, hidden, normalized, added_at FROM songs ORDER BY id').all() as unknown as SourceSong[];
  src.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const songsDir = path.join(cfg.uploadsDir, 'songs');
  const coversDir = path.join(cfg.uploadsDir, 'covers');
  const uploads = ensureUploadsRoot(db);
  fs.mkdirSync(songsDir, { recursive: true });
  fs.mkdirSync(coversDir, { recursive: true });
  let added = 0;
  let skipped = 0;
  for (const s of rows) {
    const file = path.join(srcDataDir, 'uploads', 'songs', s.file);
    if ((s.source && db.get('SELECT 1 FROM songs WHERE source = ?', s.source)) || !fs.existsSync(file)) {
      skipped++;
      continue;
    }
    fs.copyFileSync(file, path.join(songsDir, s.file));
    const cover = s.cover && fs.existsSync(path.join(srcDataDir, 'uploads', 'images', s.cover)) ? s.cover : null;
    if (cover) fs.copyFileSync(path.join(srcDataDir, 'uploads', 'images', cover), path.join(coversDir, cover));
    db.run('INSERT INTO songs(root_id, path, title, artist, cover, embedded_cover, source, hidden, normalized, added_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      uploads, s.file, s.title, s.artist, cover, cover ? 1 : 0, s.source, s.hidden, s.normalized, s.added_at);
    added++;
  }
  return { added, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir] = process.argv.slice(2);
  if (!dir) {
    console.error('Usage: npm run music:from-jonatito -- <el-jonatito data folder>');
    process.exit(1);
  }
  const cfg = loadConfig();
  const db = new Db(cfg.dbFile);
  const { added, skipped } = importFromJonatito(db, cfg, path.resolve(dir));
  console.log(`${added} songs copied${skipped ? `, ${skipped} skipped (already here or file missing)` : ''}.`);
  db.close();
}
