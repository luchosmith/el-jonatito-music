import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../server/db.ts';
import { genreKey, genresOf, parentsOf, rebuildGenres, withSubgenres } from '../server/genres.ts';
import { ensureUploadsRoot, SCHEMA_VERSION } from '../server/migrate.ts';

const names = (raw: string | null) => genresOf(raw).map(([, name]) => name);

test('a tag is split into its genres; spellings and synonyms become one genre; non-genres are dropped', () => {
  assert.deepEqual(names('Pop, Rock'), ['Pop', 'Rock']);
  assert.deepEqual(names('Funk / Soul'), ['Funk', 'Soul']);
  assert.deepEqual(names('Rock - Pop'), ['Rock', 'Pop']);
  assert.deepEqual(names('Jazz+Funk'), ['Jazz', 'Funk']);
  assert.deepEqual(names('Hip-Hop'), ['Hip-Hop & Rap'], 'a hyphen inside a word is not a split');
  assert.deepEqual(names('Hip Hop/Rap'), ['Hip-Hop & Rap'], 'two synonyms: one genre');
  assert.deepEqual(names('Pop-Rock'), ['Pop', 'Rock']);
  assert.deepEqual(names('Alt. Rock'), ['Alternative Rock']);
  assert.deepEqual(names('Pop, Rock, Alternatif et Indé'), ['Pop', 'Rock', 'Alternative', 'Indie']);
  assert.deepEqual(names('Ambiance, Musiques de Noël'), ['Christmas'], 'the whole tag is matched first');
  assert.deepEqual(names('Singer/Songwriter'), ['Singer-Songwriter']);
  assert.deepEqual(names('Rock & Roll'), ['Rock & Roll'], '& is not a split');
  assert.deepEqual(genresOf('R & B').map(([key]) => key), genresOf('R&B').map(([key]) => key), 'one genre (its name is chosen when rebuilding)');
  assert.deepEqual(names('Pop"'), ['Pop']);
  assert.deepEqual(names('Other'), []);
  assert.deepEqual(names('Film, Bandes originales de films'), ['Soundtrack']);
  assert.deepEqual(names('www.example.com'), []);
  assert.deepEqual(names(null), []);
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-genres-'));
  const db = new Db(path.join(dir, 'music.sqlite'));
  const root = ensureUploadsRoot(db);
  const add = (title: string, genre: string | null) =>
    db.run('INSERT INTO songs(root_id, path, title, genre, added_at) VALUES(?,?,?,?,?)', root, `${title}.mp3`, title, genre, '2026-11-07T00:00:00Z').lastId;
  return { dir, db, add };
}
const genresOfSong = (db: Db, id: number) =>
  db.all<{ name: string }>('SELECT g.name FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = ? ORDER BY g.name', id).map((r) => r.name);

test('rebuilding: every song gets its genres; the name most songs use wins; ids stay while a genre has songs', () => {
  const { db, add } = setup();
  const a = add('A', 'Pop, Rock');
  const b = add('B', 'shoegaze');
  const c = add('C', 'Shoe-gaze');
  add('D', 'Shoe-gaze');
  const e = add('E', 'Other');
  const f = add('F', null);
  assert.equal(rebuildGenres(db), 3);
  assert.deepEqual(genresOfSong(db, a), ['Pop', 'Rock']);
  assert.deepEqual(genresOfSong(db, b), ['Shoe-gaze'], 'one genre, spelled the way most songs spell it');
  assert.deepEqual(genresOfSong(db, c), ['Shoe-gaze']);
  assert.deepEqual([genresOfSong(db, e), genresOfSong(db, f)], [[], []]);
  const rockId = db.get<{ id: number }>("SELECT id FROM genres WHERE name = 'Rock'")!.id;
  // The tags change (a rescan): the genre keeps its id; a genre no song has any more is gone.
  db.run("UPDATE songs SET genre = 'Rock' WHERE id = ?", a);
  db.run("UPDATE songs SET genre = 'Blues' WHERE id IN (?, ?)", b, c);
  db.run("UPDATE songs SET genre = 'Blues' WHERE title = 'D'");
  assert.equal(rebuildGenres(db), 2);
  assert.equal(db.get<{ id: number }>("SELECT id FROM genres WHERE name = 'Rock'")!.id, rockId);
  assert.deepEqual(db.all<{ name: string }>('SELECT name FROM genres ORDER BY name').map((r) => r.name), ['Blues', 'Rock']);
  db.close();
});

test('an alias’s name always wins over the tags’ own spellings', () => {
  const { db, add } = setup();
  for (let i = 0; i < 5; i++) add(`R${i}`, 'Rap');
  add('H', 'Hip-Hop');
  rebuildGenres(db);
  assert.deepEqual(db.all<{ name: string }>('SELECT name FROM genres').map((r) => r.name), ['Hip-Hop & Rap']);
  db.close();
});

test('families: a name ending in another genre is under it (the longest ending); hand rules add parents and remove wrong ones', () => {
  const known = new Map(['Metal', 'Rock', 'Hard Rock', 'Fusion', 'Pop', 'Punk'].map((n) => [genreKey(n), n]));
  assert.deepEqual(parentsOf('Nu Metal', known).sort(), ['alternativemetal', 'metal']);
  assert.deepEqual(parentsOf('Melodic Hard Rock', known), ['hardrock']);
  assert.deepEqual(parentsOf('Pop-Punk', known).sort(), ['pop', 'punk']);
  assert.deepEqual(parentsOf('Afro-fusion', known), ['world']);
  assert.deepEqual(parentsOf('Rock', known), []);
});

test('rebuilding families: parents no song is tagged with appear; a genre picks everything under it; no doubled links', () => {
  const { db, add } = setup();
  const nu = add('A', 'Nu Metal');
  const metal = add('B', 'Metal');
  const salsa = add('C', 'Salsa');
  add('D', 'Pop');
  rebuildGenres(db);
  const id = (name: string) => db.get<{ id: number }>('SELECT id FROM genres WHERE name = ?', name)?.id;
  assert.ok(id('Latin') && id('Alternative Metal') && id('Alternative'), 'the families are there, with no song tagged with them');
  const songsUnder = (name: string) => db.all<{ song_id: number }>(
    `SELECT DISTINCT song_id FROM song_genres WHERE genre_id IN (${withSubgenres(db, [id(name)!]).join(',')}) ORDER BY song_id`).map((r) => r.song_id);
  assert.deepEqual(songsUnder('Metal'), [nu, metal]);
  assert.deepEqual(songsUnder('Alternative'), [nu]);
  assert.deepEqual(songsUnder('Latin'), [salsa]);
  assert.deepEqual(songsUnder('Nu Metal'), [nu]);
  const parentsOfNu = db.all<{ name: string }>('SELECT g.name FROM genre_parents gp JOIN genres g ON g.id = gp.parent_id WHERE gp.genre_id = ?', id('Nu Metal')!).map((r) => r.name);
  assert.deepEqual(parentsOfNu, ['Alternative Metal'], 'not Metal too: it is under Metal through Alternative Metal');
  db.close();
});

test('v2 -> v4: the genre tables are added and filled from the tags already there', () => {
  const { dir, db, add } = setup();
  const id = add('A', 'Funk / Soul');
  db.raw.exec('DROP TABLE genre_parents; DROP TABLE song_genres; DROP TABLE genres; PRAGMA user_version = 2');
  db.close();
  const again = new Db(path.join(dir, 'music.sqlite'));
  assert.equal(again.get<{ user_version: number }>('PRAGMA user_version')!.user_version, SCHEMA_VERSION);
  assert.deepEqual(genresOfSong(again, id), ['Funk', 'Soul']);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('music.sqlite.v2-backup-')));
  again.close();
});
