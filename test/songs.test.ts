import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from '../server/db.ts';
import { loadConfig } from '../server/config.ts';
import { importSongs, normalizeSongs, songKey, songName } from '../server/songs.ts';
import { importFromJonatito } from '../server/jonatito-import.ts';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));

test('song names: tags first; track numbers and [Explicit] go; "artist - title" file names split', () => {
  assert.deepEqual(songName('04 - La Camisa Negra [Explicit].mp3', { title: 'La Camisa Negra', artist: 'Juanes' }), { title: 'La Camisa Negra', artist: 'Juanes' });
  assert.deepEqual(songName('01. Clandestino.mp3', {}), { title: 'Clandestino', artist: null });
  assert.deepEqual(songName('1979.mp3', {}), { title: '1979', artist: null });
  assert.deepEqual(songName('01 Dancing Queen.mp3', {}), { title: 'Dancing Queen', artist: null });
  assert.deepEqual(songName('aha - take on me.mp3', { title: 'aha - take on me' }), { title: 'take on me', artist: 'aha' });
  assert.deepEqual(songName('003 Desnudate Mujer - Frankie Ruiz.mp3', { title: 'Desnudate Mujer (Frankie Ruiz)', artist: 'Frankie Ruiz' }), { title: 'Desnudate Mujer (Frankie Ruiz)', artist: 'Frankie Ruiz' });
});

test('importing a folder: files copied, cover art taken out of the file, a second import skips them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-songs-'));
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: dir });
  const db = new Db(cfg.dbFile);
  const folder = path.join(here, '..', 'e2e', 'fixtures', 'music');
  assert.deepEqual(importSongs(db, cfg, folder), { added: 3, skipped: 0 });
  const rows = db.all<{ title: string; artist: string | null; path: string; cover: string | null }>('SELECT * FROM songs ORDER BY source');
  assert.deepEqual(rows.map((r) => [r.title, r.artist, !!r.cover]), [['Tiny Tune', 'The Testers', true], ['Third One', 'Band', false], ['Short Song', 'The Beeps', false]]);
  for (const r of rows) assert.ok(fs.existsSync(path.join(cfg.uploadsDir, 'songs', r.path)));
  assert.ok(fs.existsSync(path.join(cfg.uploadsDir, 'covers', rows[0].cover!)));
  assert.deepEqual(importSongs(db, cfg, folder), { added: 0, skipped: 3 });
  db.close();
});

/** Integrated loudness (LUFS) of a file, measured by ffmpeg. */
function loudness(file: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop() ?? '');
  return Number(m?.[1]);
}

test('loudness is evened out: a very quiet and a very loud song end up at about the same volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-loud-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const tone = (name: string, db: number) => spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-af', `volume=${db}dB`, '-c:a', 'libmp3lame', path.join(src, name)]);
  tone('quiet.mp3', -28);
  tone('loud.mp3', -1);
  const before = [loudness(path.join(src, 'quiet.mp3')), loudness(path.join(src, 'loud.mp3'))];
  assert.ok(before[1] - before[0] > 20, `the test tones really differ: ${before}`);
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: dir });
  const db = new Db(cfg.dbFile);
  importSongs(db, cfg, src);
  const rows = db.all<{ path: string; normalized: number }>('SELECT path, normalized FROM songs ORDER BY source');
  assert.deepEqual(rows.map((r) => r.normalized), [1, 1]);
  const after = rows.map((r) => loudness(path.join(cfg.uploadsDir, 'songs', r.path)));
  assert.ok(Math.abs(after[0] - after[1]) < 1.5, `evened out: ${after}`);
  for (const a of after) assert.ok(Math.abs(a - -16) < 1.5, `near -16 LUFS: ${a}`);
  db.close();
});

test('songs not evened out on import are evened out by normalizeSongs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-norm-'));
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: dir });
  const db = new Db(cfg.dbFile);
  importSongs(db, cfg, path.join(here, '..', 'e2e', 'fixtures', 'music'));
  db.run('UPDATE songs SET normalized = 0');
  const { done, failed } = normalizeSongs(db, cfg);
  assert.deepEqual({ done, failed }, { done: 3, failed: 0 });
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM songs WHERE normalized = 1')!.n, 3);
  assert.equal(fs.readdirSync(path.join(cfg.uploadsDir, 'songs')).length, 3, 'the old files are gone');
  db.close();
});

test('the same song from another folder (another file name) is not imported twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-dupe-'));
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: dir });
  const db = new Db(cfg.dbFile);
  const fixtures = path.join(here, '..', 'e2e', 'fixtures', 'music');
  importSongs(db, cfg, fixtures);
  const copies = path.join(dir, 'copies');
  fs.mkdirSync(copies);
  fs.copyFileSync(path.join(fixtures, '01 - Tiny Tune.mp3'), path.join(copies, 'Tiny Tune (copy) [Explicit].mp3')); // same tags
  fs.copyFileSync(path.join(fixtures, 'The Beeps - Short Song.mp3'), path.join(copies, 'THE BEEPS - Short Sóng.mp3')); // same name, other case / accent
  assert.deepEqual(importSongs(db, cfg, copies), { added: 0, skipped: 2 });
  assert.equal(songKey('Tuttí-Frutti'), songKey('tutti frutti'));
  db.close();
});

test('a FLAC song is imported as an evened-out MP3, with its name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-flac-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=5', '-metadata', 'title=Lossless Tune', '-metadata', 'artist=Hi Fi', path.join(src, '07 - Lossless Tune.flac')]);
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: dir });
  const db = new Db(cfg.dbFile);
  assert.deepEqual(importSongs(db, cfg, src), { added: 1, skipped: 0 });
  const row = db.get<{ title: string; artist: string; path: string; normalized: number }>('SELECT * FROM songs')!;
  assert.deepEqual([row.title, row.artist, row.normalized, path.extname(row.path)], ['Lossless Tune', 'Hi Fi', 1, '.mp3']);
  db.close();
});

test('the library is copied from an El Jonatito data folder (files, covers, hidden flags); a second copy skips it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-from-'));
  const jt = path.join(dir, 'jonatito');
  fs.mkdirSync(path.join(jt, 'uploads', 'songs'), { recursive: true });
  fs.mkdirSync(path.join(jt, 'uploads', 'images'), { recursive: true });
  const fixtures = path.join(here, '..', 'e2e', 'fixtures', 'music');
  fs.copyFileSync(path.join(fixtures, '01 - Tiny Tune.mp3'), path.join(jt, 'uploads', 'songs', 'a.mp3'));
  fs.copyFileSync(path.join(fixtures, '03. Third One.mp3'), path.join(jt, 'uploads', 'songs', 'b.mp3'));
  fs.writeFileSync(path.join(jt, 'uploads', 'images', 'song-a.jpg'), 'jpg');
  const src = new DatabaseSync(path.join(jt, 'jonatito.sqlite'));
  src.exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, artist TEXT, file TEXT, cover TEXT, source TEXT, hidden INTEGER, normalized INTEGER, added_at TEXT);
    INSERT INTO songs VALUES (1, 'Tiny Tune', 'The Testers', 'a.mp3', 'song-a.jpg', '01 - Tiny Tune.mp3', 0, 1, '2026-09-29T00:00:00Z'),
                             (2, 'Third One', NULL, 'b.mp3', NULL, '03. Third One.mp3', 1, 1, '2026-09-29T00:00:00Z'),
                             (3, 'Gone', NULL, 'missing.mp3', NULL, 'Gone.mp3', 0, 1, '2026-09-29T00:00:00Z');`);
  src.close();
  const before = fs.readFileSync(path.join(jt, 'jonatito.sqlite'));
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: path.join(dir, 'music') });
  const db = new Db(cfg.dbFile);
  assert.deepEqual(importFromJonatito(db, cfg, jt), { added: 2, skipped: 1 });
  const rows = db.all<{ title: string; artist: string | null; file: string; cover: string | null; hidden: number }>('SELECT * FROM songs ORDER BY id');
  assert.deepEqual(rows.map((r) => [r.title, r.artist, r.cover, r.hidden]), [['Tiny Tune', 'The Testers', 'song-a.jpg', 0], ['Third One', null, null, 1]]);
  assert.ok(fs.existsSync(path.join(cfg.uploadsDir, 'songs', 'a.mp3')));
  assert.ok(fs.existsSync(path.join(cfg.uploadsDir, 'covers', 'song-a.jpg')));
  assert.deepEqual(importFromJonatito(db, cfg, jt), { added: 0, skipped: 3 });
  assert.ok(fs.readFileSync(path.join(jt, 'jonatito.sqlite')).equals(before), 'El Jonatito is left as it was');
  db.close();
});
