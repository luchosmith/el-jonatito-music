import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Db } from '../server/db.ts';
import { loadConfig } from '../server/config.ts';
import { SCHEMA_VERSION } from '../server/migrate.ts';
import { addRoot, measureLibrary, pickCover, scanRoot, songCover, songFile } from '../server/library.ts';
import { gainDb } from '../server/routes/songs.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'e2e', 'fixtures');

/** A fresh app (its own data folder) and a copy of the fixture library it can change. */
function setup(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jt-lib-${name}-`));
  const lib = path.join(dir, 'nas');
  fs.cpSync(path.join(fixtures, 'library'), lib, { recursive: true });
  const cfg = loadConfig({ TEST_MODE: '1', DATA_DIR: path.join(dir, 'data') });
  const db = new Db(cfg.dbFile);
  return { dir, lib, cfg, db, root: addRoot(db, lib) };
}

type Row = Record<string, string | number | null>;
const byPath = (db: Db) => Object.fromEntries(db.all<Row>('SELECT * FROM songs').map((r) => [r.path, r]));

test('a scan adds every audio file (duplicates too) with its metadata; Synology folders and hidden files are left out', async () => {
  const { db, root } = setup('scan');
  const r = await scanRoot(db, root);
  assert.deepEqual(r, { files: 7, added: 7, updated: 0, unchanged: 0, missing: 0 });
  const rows = byPath(db);
  assert.deepEqual(Object.keys(rows).sort(), ['1979.mp3', 'Artist A/Album One (copy)/01 - First.flac', 'Artist A/Album One/01 - First.flac',
    'Artist A/Album One/02 - Second.flac', 'Artist B - Loose Song.mp3', 'Box Set/CD1/01 - Disc Track.mp3', 'Odd/Old Format.wma']);
  const first = rows['Artist A/Album One/01 - First.flac'];
  assert.deepEqual(
    [first.title, first.artist, first.album, first.track_no, first.track_total, first.year, first.genre, first.codec, first.sample_rate, first.channels, first.rg_track_gain, first.missing],
    ['First', 'Artist A', 'Album One', 1, 2, 1999, 'Pop', 'flac', 8000, 1, -6, 0]);
  assert.ok(Math.abs(Number(first.duration_s) - 2) < 0.1);
  assert.equal(JSON.parse(String(first.tags)).album ?? JSON.parse(String(first.tags)).ALBUM, 'Album One');
  // The copy is its own row, with the same fingerprint (to sort out later).
  assert.equal(rows['Artist A/Album One (copy)/01 - First.flac'].quick_hash, first.quick_hash);
  assert.notEqual(rows['Artist A/Album One/02 - Second.flac'].quick_hash, first.quick_hash);
  // No tags: named from the file ("Artist - Title"); "1979" is a title, not a track number.
  assert.deepEqual([rows['Artist B - Loose Song.mp3'].title, rows['Artist B - Loose Song.mp3'].artist], ['Loose Song', 'Artist B']);
  assert.equal(rows['1979.mp3'].title, '1979');
  assert.deepEqual([rows['Box Set/CD1/01 - Disc Track.mp3'].disc_no, rows['Box Set/CD1/01 - Disc Track.mp3'].disc_total], [1, 2]);
  assert.equal(rows['Odd/Old Format.wma'].codec, 'wmav2');
  // Folder pictures: the album's own; a disc folder uses its album's; nothing uses a picture at the very top.
  assert.equal(first.folder_cover, 'Artist A/Album One/cover.jpg');
  assert.equal(rows['Artist A/Album One (copy)/01 - First.flac'].folder_cover, null);
  assert.equal(rows['Box Set/CD1/01 - Disc Track.mp3'].folder_cover, 'Box Set/folder.jpg');
  assert.equal(rows['Artist B - Loose Song.mp3'].folder_cover, null);
  db.close();
});

test('scanning again reads only new and changed files, and marks the ones that are gone as missing (and back)', async () => {
  const { db, root, lib } = setup('rescan');
  await scanRoot(db, root);
  assert.deepEqual(await scanRoot(db, root), { files: 7, added: 0, updated: 0, unchanged: 7, missing: 0 });
  const second = path.join(lib, 'Artist A/Album One/02 - Second.flac');
  const moved = path.join(lib, '..', 'second.flac');
  fs.renameSync(second, moved);
  fs.copyFileSync(path.join(fixtures, 'music', '01 - Tiny Tune.mp3'), path.join(lib, 'Odd', 'New One.mp3'));
  fs.utimesSync(path.join(lib, '1979.mp3'), new Date(), new Date('2020-01-01'));
  assert.deepEqual(await scanRoot(db, root), { files: 7, added: 1, updated: 1, unchanged: 5, missing: 1 });
  assert.equal(byPath(db)['Artist A/Album One/02 - Second.flac'].missing, 1);
  assert.equal(byPath(db)['Odd/New One.mp3'].title, 'Tiny Tune');
  fs.renameSync(moved, second);
  await scanRoot(db, root);
  assert.equal(byPath(db)['Artist A/Album One/02 - Second.flac'].missing, 0);
  db.close();
});

test('an empty folder (the NAS not mounted) changes nothing', async () => {
  const { db, root, lib } = setup('empty');
  await scanRoot(db, root);
  fs.rmSync(lib, { recursive: true });
  await assert.rejects(scanRoot(db, root), /is not there/);
  fs.mkdirSync(lib);
  await assert.rejects(scanRoot(db, root), /is the NAS mounted/);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM songs WHERE missing = 1')!.n, 0);
  db.close();
});

test('covers: the picture inside the file, else the folder one (made once per album), else none', async () => {
  const { db, root, lib, cfg } = setup('covers');
  fs.copyFileSync(path.join(fixtures, 'music', '01 - Tiny Tune.mp3'), path.join(lib, 'Artist A', 'Album One', '03 - Tiny Tune.mp3'));
  await scanRoot(db, root);
  const id = (p: string) => Number(byPath(db)[p].id);
  const coversDir = path.join(cfg.uploadsDir, 'covers');
  const embedded = await songCover(db, cfg, id('Artist A/Album One/03 - Tiny Tune.mp3'));
  assert.match(embedded!, /^song-/);
  const a = await songCover(db, cfg, id('Artist A/Album One/01 - First.flac'));
  const b = await songCover(db, cfg, id('Artist A/Album One/02 - Second.flac'));
  assert.match(a!, /^folder-/);
  assert.equal(a, b, 'one picture for the album');
  assert.ok(fs.existsSync(path.join(coversDir, a!)));
  assert.equal(await songCover(db, cfg, id('Artist B - Loose Song.mp3')), null);
  assert.equal(byPath(db)['Artist B - Loose Song.mp3'].cover, '', 'tried: not tried again');
  db.close();
});

test('a song file is found in its root, wherever that is', async () => {
  const { db, root, lib, cfg } = setup('file');
  await scanRoot(db, root);
  assert.equal(songFile(db, cfg, Number(byPath(db)['Odd/Old Format.wma'].id)), path.join(lib, 'Odd', 'Old Format.wma'));
  db.close();
});

test('loudness: measured once per song (and the player gain follows from it)', async () => {
  const { db, root, cfg } = setup('loud');
  await scanRoot(db, root);
  assert.deepEqual(await measureLibrary(db, cfg, { limit: 3 }), { done: 3, failed: 0 });
  const measured = db.all<{ loudness_lufs: number }>('SELECT loudness_lufs FROM songs WHERE loudness_lufs IS NOT NULL');
  assert.equal(measured.length, 3);
  for (const m of measured) assert.ok(m.loudness_lufs < 0 && m.loudness_lufs > -40, String(m.loudness_lufs));
  assert.equal(gainDb({ normalized: 1, loudness_lufs: null, rg_track_gain: null }), 0);
  assert.equal(gainDb({ normalized: 0, loudness_lufs: -10, rg_track_gain: -3 }), -6);
  assert.equal(gainDb({ normalized: 0, loudness_lufs: null, rg_track_gain: -6 }), -4);
  assert.equal(gainDb({ normalized: 0, loudness_lufs: -99, rg_track_gain: null }), null);
  db.close();
});

test('folder pictures: cover / folder / front first; never the back of the case', () => {
  assert.equal(pickCover(['back.jpg', 'Folder.jpg', 'a.jpg']), 'Folder.jpg');
  assert.equal(pickCover(['back.jpg', 'Album Cover (front).jpg']), 'Album Cover (front).jpg');
  assert.equal(pickCover(['back.jpg', 'scan1.jpg']), 'scan1.jpg');
  assert.equal(pickCover(['back.jpg']), null);
});

test('v1 -> v2: the songs so far become the uploads folder’s, with a backup of the old database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-v1-'));
  const file = path.join(dir, 'music.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, artist TEXT, file TEXT NOT NULL, cover TEXT,
    source TEXT UNIQUE, hidden INTEGER NOT NULL DEFAULT 0, normalized INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL);
    INSERT INTO songs VALUES (7, 'Dura', 'Daddy Yankee', 'a.mp3', 'song-a.jpg', '01 - Dura.mp3', 0, 1, '2026-09-29T00:00:00Z'),
                             (9, 'Venus', NULL, 'b.mp3', NULL, 'Venus.mp3', 1, 1, '2026-09-29T00:00:00Z');`);
  old.close();
  const db = new Db(file);
  assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, SCHEMA_VERSION);
  const rows = db.all<Row>("SELECT s.id, s.path, s.title, s.cover, s.embedded_cover, s.hidden, s.normalized, r.kind FROM songs s JOIN roots r ON r.id = s.root_id ORDER BY s.id");
  assert.deepEqual(rows.map((r) => [r.id, r.path, r.title, r.cover, r.embedded_cover, r.hidden, r.normalized, r.kind]),
    [[7, 'a.mp3', 'Dura', 'song-a.jpg', 1, 0, 1, 'uploads'], [9, 'b.mp3', 'Venus', null, 0, 1, 1, 'uploads']]);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('music.sqlite.v1-backup-')));
  db.close();
  // Opening it again changes nothing (no second backup).
  new Db(file).close();
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('backup')).length, 1);
});
