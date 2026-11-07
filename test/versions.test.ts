import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../server/db.ts';
import { addRoot, PLAYABLE_CODECS } from '../server/library.ts';
import { SCHEMA_VERSION } from '../server/migrate.ts';
import { artistKey, rebuildVersions, titleKey } from '../server/versions.ts';

test('the same song: noise in the title is left out; live, remixes, takes ... are other recordings', () => {
  const t = (title: string, album: string | null = null) => titleKey(title, album);
  assert.deepEqual(t('Hound Dog (2012 Remaster)'), t('Hound Dog'));
  assert.deepEqual(t('Hound Dog - Remastered 2009'), t('Hound Dog'));
  assert.deepEqual(t('Hound Dog [Explicit]'), t('hound dog'));
  assert.deepEqual(t('Earth Song (Radio Edit)'), t('Earth Song'));
  assert.deepEqual(t("Don'T Be Cruel"), t("Don't Be Cruel"));
  assert.notDeepEqual(t('Hound Dog (Live)'), t('Hound Dog'));
  assert.notDeepEqual(t('Hound Dog - Live at Madison Square Garden'), t('Hound Dog'));
  assert.notDeepEqual(t('Blue (Da Ba Dee) (Gabry Ponte Remix)'), t('Blue (Da Ba Dee)'));
  assert.notDeepEqual(t('Hound Dog (Take 3)'), t('Hound Dog (Take 5)'));
  assert.notDeepEqual(t('Hound Dog', 'Elvis: Live in Las Vegas'), t('Hound Dog', 'Elvis 30 #1 Hits'), 'a live album is another performance');
  assert.notDeepEqual(t('Hound Dog (Live)', 'Las Vegas 1975'), t('Hound Dog (Live)', 'Madison Square Garden 1972'), 'each live album is its own');
  assert.notDeepEqual(t('Theme (Love Theme)'), t('Theme'), 'an unknown bracket stays part of the title');
  assert.equal(artistKey('The Beatles'), artistKey('Beatles'));
  assert.equal(artistKey('Luis Fonsi ft. Daddy Yankee'), artistKey('Luis Fonsi'));
  assert.equal(artistKey('AC/DC'), artistKey('AC-DC'));
  assert.notEqual(artistKey('Earth, Wind & Fire'), artistKey('Earth'), 'not split on "," or "&"');
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-versions-'));
  const db = new Db(path.join(dir, 'music.sqlite'));
  const root = addRoot(db, path.join(dir, 'nas'));
  let n = 0;
  const add = (o: { title: string; artist?: string | null; album?: string; codec?: string; bitrate?: number; bit_depth?: number; sample_rate?: number; duration_s?: number | null; year?: number; album_artist?: string; hidden?: number }) =>
    db.run(`INSERT INTO songs(root_id, path, title, artist, album, album_artist, codec, bitrate, bit_depth, sample_rate, duration_s, year, hidden, added_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      root.id, `f${n++}`, o.title, o.artist === undefined ? 'Elvis Presley' : o.artist, o.album ?? 'Some Album', o.album_artist ?? null, o.codec ?? 'flac',
      o.bitrate ?? 900_000, o.bit_depth ?? 16, o.sample_rate ?? 44100, o.duration_s === undefined ? 120 : o.duration_s, o.year ?? 2000, o.hidden ?? 0, '2026-11-07T00:00:00Z').lastId;
  const mainOf = (id: number) => db.get<{ id: number }>('SELECT id FROM songs WHERE version_key = (SELECT version_key FROM songs WHERE id = ?) AND is_main = 1', id)!.id;
  const same = (a: number, b: number) => mainOf(a) === mainOf(b);
  return { db, add, mainOf, same };
}

test('the main copy: lossless, then the original album over a compilation, then better sound, then the earliest year', () => {
  const { db, add, mainOf } = setup();
  const mp3 = add({ title: 'Song A', codec: 'mp3', bitrate: 320_000, album: 'Original' });
  const comp = add({ title: 'Song A', album: 'The Greatest Hits', bit_depth: 24, sample_rate: 96000 });
  const orig = add({ title: 'Song A', album: 'Original', year: 1960 });
  add({ title: 'Song A', album: 'Original (reissue)', year: 1999 });
  const various = add({ title: 'Song B', album: 'Some Hits Of The 50s', album_artist: 'Various Artists' });
  const lo = add({ title: 'Song B', album: 'Album B', codec: 'mp3', bitrate: 128_000 });
  rebuildVersions(db, PLAYABLE_CODECS);
  assert.equal(mainOf(mp3), orig, 'FLAC over MP3; the original album over a 24-bit compilation; 1960 over 1999');
  assert.equal(mainOf(comp), orig);
  assert.equal(mainOf(lo), various, 'lossless first, even from a compilation');
  db.close();
});

test('grouping: other lengths are other recordings; a copy of unknown length joins the most copies; no artist, no grouping', () => {
  const { db, add, same } = setup();
  const a = add({ title: 'Song', duration_s: 120 });
  const b = add({ title: 'Song', duration_s: 126 });
  const c = add({ title: 'Song', duration_s: 129 });
  const ext = add({ title: 'Song', duration_s: 300 });
  const unknown = add({ title: 'Song', duration_s: null });
  const live = add({ title: 'Song (Live)', duration_s: 121 });
  const intro1 = add({ title: 'Intro', artist: null });
  const intro2 = add({ title: 'Intro', artist: null });
  const { songs, main } = rebuildVersions(db, PLAYABLE_CODECS);
  assert.ok(same(a, b) && same(b, c) && same(a, unknown));
  assert.ok(!same(a, ext) && !same(a, live) && !same(intro1, intro2));
  assert.deepEqual([songs, main], [8, 5]);
  db.close();
});

test('a hidden song stays hidden: a copy found later is hidden too', () => {
  const { db, add } = setup();
  const hid = add({ title: 'Song', codec: 'mp3', bitrate: 128_000, hidden: 1 });
  const flac = add({ title: 'Song' });
  rebuildVersions(db, PLAYABLE_CODECS);
  assert.deepEqual(db.all<{ hidden: number }>('SELECT hidden FROM songs WHERE id IN (?, ?) ORDER BY id', hid, flac).map((r) => r.hidden), [1, 1]);
  db.close();
});

test('picked by hand: that copy is the main one, whatever the rules say', () => {
  const { db, add, mainOf } = setup();
  const best = add({ title: 'Song' });
  const mp3 = add({ title: 'Song', codec: 'mp3', bitrate: 128_000 });
  rebuildVersions(db, PLAYABLE_CODECS);
  assert.equal(mainOf(mp3), best);
  db.run('UPDATE songs SET preferred = 1 WHERE id = ?', mp3);
  rebuildVersions(db, PLAYABLE_CODECS);
  assert.equal(mainOf(best), mp3);
  db.close();
});

test('v4 -> v5: the new columns are added and the copies grouped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-v5-'));
  const file = path.join(dir, 'music.sqlite');
  const db = new Db(file);
  const root = addRoot(db, dir);
  for (const p of ['a', 'b']) db.run("INSERT INTO songs(root_id, path, title, artist, codec, duration_s, added_at) VALUES(?, ?, 'Song', 'X', 'flac', 100, '2026-11-07')", root.id, p);
  db.raw.exec('DROP INDEX songs_version; ALTER TABLE songs DROP COLUMN version_key; ALTER TABLE songs DROP COLUMN is_main; ALTER TABLE songs DROP COLUMN preferred; PRAGMA user_version = 4');
  db.close();
  const again = new Db(file);
  assert.equal(again.get<{ user_version: number }>('PRAGMA user_version')!.user_version, SCHEMA_VERSION);
  assert.deepEqual(again.all<{ is_main: number }>('SELECT is_main FROM songs ORDER BY id').map((r) => r.is_main), [1, 0]);
  again.close();
});
