// Genres: the genre tags cleaned up, for filtering. A tag can hold several genres ("Pop, Rock", "Funk / Soul"),
// one genre is spelled many ways ("Alternative-Rock", "Alt. Rock", "alternative rock"), and some tags are not
// genres at all ("Other", a web address). Each song's raw tag stays as it is in songs.genre; the genres made
// from it go in `genres` / `song_genres`, and which genre is a kind of which in `genre_parents`, all rebuilt
// from the tags after every scan, so the rules below can change any time: edit them and run
// `npm run library:genres`.
import type { Db } from './db.ts';

/** "Alternative-Rock", "alternative rock" and "Alternative Rock" are one: lower case, no accents, letters, digits and & only. */
export const genreKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&]+/g, '');

/** Splits a tag into its genres: on , ; / + and " - " (not on "-" inside a word: Hip-Hop, Nu-Metal). */
const SPLIT = /\s*(?:[,;/+|]|\s-\s)\s*/;

/** Not a genre: the song gets none from it. */
const DROP = ['genre', 'other', 'others', 'various', 'divers', 'misc', 'miscellaneous', 'musik', 'data', 'unclassifiable', 'general unclassifiable',
  'unknown', 'popular', 'international', 'film', 'beck', 'wu', 'cult', 'diction', 'mind food', 'brainsync'];

/**
 * Synonyms and tags that mean several genres. The left side is matched by genreKey (so its spelling, case and
 * accents don't matter), first on the whole tag, then on each part of it after splitting.
 */
const ALIASES: [string, ...string[]][] = [
  // Rock
  ['Alt. Rock', 'Alternative Rock'], ['AlternRock', 'Alternative Rock'], ['General Alternative Rock', 'Alternative Rock'],
  ['General Alternative', 'Alternative'], ['Alternatif et Indé', 'Alternative', 'Indie'], ['Alternative & Indie', 'Alternative', 'Indie'],
  ['Alternative & Punk', 'Alternative', 'Punk'], ['Pop Rock', 'Pop', 'Rock'], ['Rock progressif', 'Progressive Rock'],
  ['Proto-Prog', 'Progressive Rock'], ['Folk/Rock', 'Folk Rock'], ['Stoner/Acid Rock', 'Stoner Rock', 'Acid Rock'], ['Rap-Rock', 'Rap Rock'],
  // Punk & metal
  ['Punk Rock', 'Punk'], ['Alt. Metal', 'Alternative Metal'], ['Alt.Metal', 'Alternative Metal'], ['NWOBHM', 'Heavy Metal'],
  ['Heavy / Power / Neoclassic', 'Heavy Metal', 'Power Metal', 'Neoclassical Metal'],
  // Hip-hop, R&B, soul
  ['Rap', 'Hip-Hop & Rap'], ['Hip-Hop', 'Hip-Hop & Rap'], ['Hip Hop Rap', 'Hip-Hop & Rap'], ['Rap & Hip-Hop', 'Hip-Hop & Rap'],
  ['Conscious Rap/Hip-Hop', 'Hip-Hop & Rap'], ['Christian Rap', 'Hip-Hop & Rap'], ['Pop Rap', 'Hip-Hop & Rap'], ['G-funk', 'Hip-Hop & Rap'],
  ['RnB', 'R&B'], ['Soul and R&B', 'Soul', 'R&B'], ['Smooth Soul', 'Soul'],
  // Electronic & dance
  ['Électronique', 'Electronic'], ['Electronica', 'Electronic'], ['Electro', 'Electronic'], ['Electronica-Dance', 'Electronic', 'Dance'],
  ['Dance & DJ', 'Dance'], ['Club', 'Dance'], ['House N Trance', 'House', 'Trance'], ['house 6', 'House'], ['Disco 70', 'Disco'],
  // Latin & world
  ['Latin Music', 'Latin'], ['Amérique latine', 'Latin'], ['Musiques du monde', 'World'], ['Brasil', 'Brazilian'], ['Brazilian Music', 'Brazilian'],
  ['Cumbias', 'Cumbia'], ['Salsa y Tropical', 'Salsa', 'Tropical'], ['latin reggae', 'Reggaeton'], ['boricua reggae', 'Reggaeton'],
  ['Reggaeton y Hip-Hop', 'Reggaeton', 'Hip-Hop & Rap'], ['General Reggae', 'Reggae'], ['Ska & Rocksteady', 'Ska', 'Rocksteady'],
  // Soundtracks, moods, the rest
  ['Sound Track', 'Soundtrack'], ['OST', 'Soundtrack'], ['Bandes originales de films', 'Soundtrack'], ['Comédies musicales', 'Musicals'],
  ['Ambiance, Musiques de Noël', 'Christmas'], ['Musiques de Noël', 'Christmas'], ['Holiday', 'Christmas'],
  ['Ambience', 'Ambient'], ['Meditative', 'New Age'], ['Enfants', "Children's"], ['Kids', "Children's"],
  ['JPop', 'J-Pop'], ['Top 40', 'Pop'], ['General Teen Pop', 'Teen Pop'], ['Singer/Songwriter', 'Singer-Songwriter'],
];

const dropKeys = new Set(DROP.map(genreKey));
const aliasMap = new Map(ALIASES.map(([from, ...to]) => [genreKey(from), to]));

/** Leftover quotes and spaces ('Pop"'); web addresses and e-mails are junk. */
const clean = (s: string) => s.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
const isJunk = (s: string) => /https?:|www\.|@/i.test(s);

/**
 * The genres in a raw tag, before display names are chosen: each is a [key, spelling] pair. An alias gives
 * its name as the spelling; otherwise the tag's own spelling is kept (the most common one wins later).
 */
export function genresOf(raw: string | null): [string, string][] {
  if (!raw || isJunk(raw)) return [];
  const whole = aliasMap.get(genreKey(raw));
  const parts = whole ?? raw.split(SPLIT);
  const out = new Map<string, string>();
  for (const p of parts.map(clean)) {
    const key = genreKey(p);
    if (!key || dropKeys.has(key) || isJunk(p)) continue;
    const to = whole ? [p] : aliasMap.get(key) ?? [p];
    for (const g of to) if (!out.has(genreKey(g))) out.set(genreKey(g), g);
  }
  return [...out];
}

// ---- Families: which genres are a kind of which -------------------------------------------------
// Picking a genre in a filter also picks everything under it (Metal: Nu Metal, Heavy Metal, Power Metal ...).
// Automatic: a genre whose name ends in another genre's name is under it ("Nu Metal" -> Metal, "Melodic Hard
// Rock" -> Hard Rock -> Rock, "J-Pop" -> Pop). By hand, below: more parents, names that don't say it, and the
// automatic matches that are wrong. Families are siblings, not under each other: Metal, Punk, Alternative and
// Rock; Latin and World; Dance and Electronic; R&B, Soul and Funk.

/** [genre, ...its parents], added to the automatic one. A parent no song is tagged with still appears (empty itself). */
const PARENTS: [string, ...string[]][] = [
  // Rock
  ['Alternative Rock', 'Alternative'], ['Indie Rock', 'Indie'], ['Indie', 'Alternative'], ['Grunge', 'Rock', 'Alternative'],
  ['Krautrock', 'Progressive Rock'], ['Progressive Hard Rock', 'Progressive Rock'], ['Rock & Roll', 'Rock'], ['Rock Organ', 'Rock'],
  ['Rock en Español', 'Rock', 'Latin'], ['Beat', 'Rock'], ['Mod', 'Rock'], ['New Wave', 'Rock', 'Pop'], ['Original New Wave Scene', 'New Wave'],
  ['Britpop', 'Rock', 'Pop'], ['Blues Rock', 'Blues'], ['Folk Rock', 'Folk'], ['Country Rock', 'Country'], ['Funk Rock', 'Funk'],
  ['Jazz-Rock', 'Jazz'], ['Rap Rock', 'Hip-Hop & Rap'], ['Reggae Rock', 'Reggae'], ['Beat Rock', 'Beat'],
  // Metal & punk
  ['Alternative Metal', 'Alternative'], ['Nu Metal', 'Alternative Metal'], ['Industrial Metal', 'Industrial'],
  ['Pop-Punk', 'Pop'], ['Post-Hardcore', 'Punk'], ['Punk Blues', 'Punk'], ['Punk-funk', 'Punk'],
  // Pop
  ['Synthpop', 'Pop', 'Electronic'], ['Electropop', 'Pop', 'Electronic'], ['Europop', 'Pop', 'Dance'], ['Dance Pop', 'Dance'],
  ['Latin Pop', 'Latin'], ['Pop-Folk', 'Pop'], ['Pop Reggae', 'Pop'],
  // Electronic & dance
  ['House', 'Electronic', 'Dance'], ['Trance', 'Electronic', 'Dance'], ['Techno', 'Electronic', 'Dance'], ['Eurodance', 'Dance', 'Electronic'],
  ['Ambient', 'Electronic'], ['Downtempo', 'Electronic'], ['Chillout', 'Electronic'], ['Dubstep', 'Electronic'], ['Breakbeat', 'Electronic'],
  ['Acid', 'Electronic'], ['EBM', 'Electronic'], ['Futurepop', 'Electronic'], ['Industrial', 'Electronic'], ['Dream', 'Electronic'],
  ['Freestyle', 'Dance'], ['Hi-NRG', 'Disco'], ['Eurodisco', 'Disco'], ['Disco', 'Dance'],
  // Latin, world, reggae
  ['Salsa', 'Latin'], ['Reggaeton', 'Latin'], ['Cumbia', 'Latin'], ['Cuban', 'Latin'], ['Brazilian', 'Latin'], ['Bossa Nova', 'Brazilian'],
  ['Tango', 'Latin'], ['Tropical', 'Latin'], ['Celtic', 'World'], ['Afro-fusion', 'World'],
  ['Ska', 'Reggae'], ['Rocksteady', 'Reggae'], ['Dance Hall', 'Reggae'],
  // Jazz, blues, soul, folk, classical
  ['Fusion', 'Jazz'], ['Swing', 'Jazz'], ['Soul-Jazz', 'Soul'], ['Psychedelic Soul', 'Soul'], ['Doo-wop', 'R&B'],
  ['Bluegrass', 'Country'], ['Neofolk', 'Folk'], ['Singer-Songwriter', 'Folk'],
  ['Classical Guitar', 'Classical'], ['Classical Crossover', 'Classical'], ['Symphonic', 'Classical'], ['A Cappella', 'Vocal'],
  ['Vocal Jazz', 'Vocal'], ['Musicals', 'Soundtrack'], ['Anime', 'Soundtrack'],
];

/** [genre, parent]: automatic matches that are wrong. */
const NOT_PARENTS: [string, string][] = [['Afro-fusion', 'Fusion']];

const handParents = new Map<string, string[]>();
for (const [g, ...ps] of PARENTS) handParents.set(genreKey(g), [...(handParents.get(genreKey(g)) ?? []), ...ps]);
const notParents = new Set(NOT_PARENTS.map(([g, p]) => `${genreKey(g)}>${genreKey(p)}`));
/** How rule names are spelled when a rule brings in a genre no song is tagged with. */
const ruleNames = new Map(PARENTS.flat().map((n) => [genreKey(n), n]));

/** The genre's parents (keys), given the genres there are (keys -> names): the hand-written ones and the automatic one. */
export function parentsOf(name: string, known: Map<string, string>): string[] {
  const key = genreKey(name);
  const out = new Set((handParents.get(key) ?? []).map(genreKey));
  // The longest ending of the name that is a genre ("Melodic Hard Rock": Hard Rock, not Rock).
  for (let i = 1; i < name.length; i++) {
    if (name[i - 1] !== ' ' && name[i - 1] !== '-') continue;
    const k = genreKey(name.slice(i));
    if (k !== key && known.has(k) && !notParents.has(`${key}>${k}`)) {
      out.add(k);
      break;
    }
  }
  return [...out].filter((p) => p !== key);
}

/**
 * Rebuilds `genres`, `song_genres` and `genre_parents` from the songs' genre tags. A genre keeps its id while it
 * is used (so a saved filter that names it keeps working); its display name is the alias or rule name, or else
 * the spelling most songs use. A family genre is kept even when no song has that exact tag. Returns how many
 * genres there are.
 */
export function rebuildGenres(db: Db): number {
  const tags = db.all<{ genre: string; n: number }>('SELECT genre, COUNT(*) AS n FROM songs WHERE genre IS NOT NULL GROUP BY genre');
  const ruleSpelled = new Set([...ALIASES.flatMap(([, ...to]) => to), ...ruleNames.values()]);
  // key -> the spellings seen, with how many songs use each
  const spellings = new Map<string, Map<string, number>>();
  const parsed = tags.map((t) => ({ ...t, genres: genresOf(t.genre) }));
  for (const t of parsed) {
    for (const [key, name] of t.genres) {
      const m = spellings.get(key) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + t.n + (ruleSpelled.has(name) ? 1e9 : 0)); // an alias's or rule's name always wins
      spellings.set(key, m);
    }
  }
  const names = new Map([...spellings].map(([key, m]) => [key, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]));
  // The families: every genre's parents, and theirs, adding the ones no song is tagged with.
  const edges = new Map<string, string[]>();
  const todo = [...names.keys()];
  while (todo.length) {
    const key = todo.pop()!;
    if (edges.has(key)) continue;
    const ps = parentsOf(names.get(key)!, new Map([...names, ...ruleNames]));
    edges.set(key, ps);
    for (const p of ps) if (!names.has(p)) { names.set(p, ruleNames.get(p)!); todo.push(p); }
  }
  // No loops: a parent can't also be under its child.
  const under = (k: string, target: string, seen = new Set<string>()): boolean =>
    k === target || (!seen.has(k) && (seen.add(k), (edges.get(k) ?? []).some((p) => under(p, target, seen))));
  for (const [k, ps] of edges) edges.set(k, ps.filter((p) => !under(p, k)));
  // A direct link to a genre already above another parent is left out (Nu Metal: under Alternative Metal, which is under Metal).
  for (const [k, ps] of edges) edges.set(k, ps.filter((p) => !ps.some((q) => q !== p && under(q, p))));

  return db.tx(() => {
    const ids = new Map<string, number>();
    for (const g of db.all<{ id: number; name: string }>('SELECT id, name FROM genres')) ids.set(genreKey(g.name), g.id);
    for (const [key, name] of names) {
      const id = ids.get(key);
      if (id) db.run('UPDATE genres SET name = ? WHERE id = ? AND name <> ?', name, id, name);
      else ids.set(key, db.run('INSERT INTO genres(name) VALUES(?)', name).lastId);
    }
    db.run('DELETE FROM song_genres');
    db.run('DELETE FROM genre_parents');
    db.raw.exec('CREATE TEMP TABLE IF NOT EXISTS tag_genres (tag TEXT NOT NULL, genre_id INTEGER NOT NULL); DELETE FROM tag_genres;');
    for (const t of parsed) for (const [key] of t.genres) db.run('INSERT INTO tag_genres VALUES(?, ?)', t.genre, ids.get(key)!);
    db.run('INSERT OR IGNORE INTO song_genres(song_id, genre_id) SELECT s.id, t.genre_id FROM songs s JOIN tag_genres t ON t.tag = s.genre');
    db.raw.exec('DROP TABLE tag_genres');
    for (const [k, ps] of edges) for (const p of ps) db.run('INSERT OR IGNORE INTO genre_parents(genre_id, parent_id) VALUES(?, ?)', ids.get(k)!, ids.get(p)!);
    db.run(`DELETE FROM genres WHERE id NOT IN (${[...names.keys()].map((k) => ids.get(k)).join(',') || 'NULL'})`);
    return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM genres')!.n;
  });
}

/** The genre and every genre under it, at any depth (Metal: Nu Metal, Power Metal, Melodic Power Metal ...). */
export function withSubgenres(db: Db, genreIds: number[]): number[] {
  if (!genreIds.length) return [];
  return db.all<{ id: number }>(
    `WITH RECURSIVE sub(id) AS (SELECT value FROM json_each(?) UNION SELECT gp.genre_id FROM genre_parents gp JOIN sub ON gp.parent_id = sub.id)
     SELECT id FROM sub`, JSON.stringify(genreIds)).map((r) => r.id);
}
