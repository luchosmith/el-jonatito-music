// Rebuilds the genres from the songs' genre tags (after changing the rules in server/genres.ts) and lists
// them as families: each genre with how many songs it picks (itself and everything under it) and how many
// have exactly that tag. Scans rebuild them too.
// Usage: npm run library:genres                (the families)
//        npm run library:genres -- --tags      (a flat list: each genre and the tags it was made from)
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { rebuildGenres, withSubgenres } from './genres.ts';

const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const n = rebuildGenres(db);

if (process.argv.includes('--tags')) {
  const rows = db.all<{ name: string; songs: number; tags: string }>(
    `SELECT g.name, COUNT(*) AS songs,
            (SELECT json_group_array(t) FROM (SELECT s2.genre || ' (' || COUNT(*) || ')' AS t FROM song_genres sg2 JOIN songs s2 ON s2.id = sg2.song_id
              WHERE sg2.genre_id = g.id GROUP BY s2.genre ORDER BY COUNT(*) DESC)) AS tags
     FROM genres g JOIN song_genres sg ON sg.genre_id = g.id GROUP BY g.id ORDER BY songs DESC, g.name`);
  for (const r of rows) console.log(`${String(r.songs).padStart(6)}  ${r.name.padEnd(24)} ${(JSON.parse(r.tags) as string[]).join(' · ')}`);
} else {
  const genres = db.all<{ id: number; name: string }>('SELECT id, name FROM genres');
  const name = new Map(genres.map((g) => [g.id, g.name]));
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  for (const e of db.all<{ genre_id: number; parent_id: number }>('SELECT genre_id, parent_id FROM genre_parents')) {
    parents.set(e.genre_id, [...(parents.get(e.genre_id) ?? []), e.parent_id]);
    children.set(e.parent_id, [...(children.get(e.parent_id) ?? []), e.genre_id]);
  }
  const songsOf = new Map<number, Set<number>>();
  for (const r of db.all<{ genre_id: number; song_id: number }>('SELECT genre_id, song_id FROM song_genres')) {
    songsOf.set(r.genre_id, (songsOf.get(r.genre_id) ?? new Set()).add(r.song_id));
  }
  const own = (id: number) => songsOf.get(id)?.size ?? 0;
  const total = new Map(genres.map((g) => {
    const all = new Set<number>();
    for (const sub of withSubgenres(db, [g.id])) for (const s of songsOf.get(sub) ?? []) all.add(s);
    return [g.id, all.size];
  }));
  const byTotal = (a: number, b: number) => total.get(b)! - total.get(a)! || name.get(a)!.localeCompare(name.get(b)!);
  const line = (id: number, depth: number, from?: number) => {
    const others = (parents.get(id) ?? []).filter((p) => p !== from).map((p) => name.get(p));
    const exact = own(id) !== total.get(id) ? `  (tagged exactly: ${own(id)})` : '';
    console.log(`${String(total.get(id)).padStart(6)}  ${'    '.repeat(depth)}${name.get(id)}${exact}${others.length ? `  — also under ${others.join(', ')}` : ''}`);
    for (const c of (children.get(id) ?? []).sort(byTotal)) line(c, depth + 1, id);
  };
  const roots = genres.map((g) => g.id).filter((id) => !parents.has(id)).sort(byTotal);
  const families = roots.filter((id) => children.has(id));
  const alone = roots.filter((id) => !children.has(id));
  for (const id of families) {
    line(id, 0);
    console.log('');
  }
  console.log(`On their own: ${alone.map((id) => `${name.get(id)} (${total.get(id)})`).join(' · ')}`);
}

const none = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM songs s WHERE s.missing = 0 AND NOT EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id)')!.n;
const dropped = db.all<{ genre: string; n: number }>(
  `SELECT genre, COUNT(*) AS n FROM songs s WHERE genre IS NOT NULL AND NOT EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id) GROUP BY genre ORDER BY n DESC`);
console.log(`\n${n} genres. ${none} songs have none${dropped.length ? `, incl. ${dropped.reduce((a, d) => a + d.n, 0)} whose tag is not a genre: ${dropped.map((d) => `${d.genre} (${d.n})`).join(' · ')}` : ''}.`);
db.close();
