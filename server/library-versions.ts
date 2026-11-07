// Regroups the copies of each song and picks the main ones (after changing the rules in server/versions.ts),
// then shows how it went. Scans regroup them too.
// Usage: npm run library:versions                  (the numbers, and the songs with the most copies)
//        npm run library:versions -- <words>       (every song whose artist or title has these words, with its copies)
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { PLAYABLE_CODECS } from './library.ts';
import { rebuildVersions } from './versions.ts';

const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const { songs, main } = rebuildVersions(db, PLAYABLE_CODECS);
const words = process.argv.slice(2).join(' ').trim();

interface Row { id: number; version_key: string; title: string; artist: string | null; album: string | null; year: number | null; codec: string | null; bitrate: number | null; bit_depth: number | null; sample_rate: number | null; duration_s: number | null; is_main: number }
const show = (key: string) => {
  const copies = db.all<Row>('SELECT id, version_key, title, artist, album, year, codec, bitrate, bit_depth, sample_rate, duration_s, is_main FROM songs WHERE version_key = ? ORDER BY is_main DESC, id', key);
  const first = copies[0];
  console.log(`\n${first.artist ?? '?'} — ${first.title}  (${copies.length} ${copies.length === 1 ? 'copy' : 'copies'})`);
  for (const c of copies) {
    const secs = Math.round(c.duration_s ?? 0);
    const len = c.duration_s ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '?';
    console.log(`  ${c.is_main ? '▶' : ' '} #${String(c.id).padEnd(6)} ${(c.codec ?? '?').padEnd(5)} ${(c.codec === 'flac' || c.codec?.startsWith('pcm_') ? `${c.bit_depth ?? '?'}/${Math.round((c.sample_rate ?? 0) / 100) / 10}` : `${Math.round((c.bitrate ?? 0) / 1000)}k`).padStart(8)}  ${len.padStart(5)}  ${c.year ?? '    '}  ${c.title}  ·  ${c.album ?? ''}`);
  }
};

if (words) {
  const like = `%${words}%`;
  const keys = db.all<{ version_key: string }>(
    `SELECT version_key FROM songs WHERE artist LIKE ? OR title LIKE ? GROUP BY version_key ORDER BY MIN(artist), MIN(title) LIMIT 60`, like, like);
  for (const k of keys) show(k.version_key);
} else {
  const multi = db.get<{ groups: number; copies: number }>('SELECT COUNT(*) AS groups, SUM(n) AS copies FROM (SELECT COUNT(*) AS n FROM songs GROUP BY version_key HAVING n > 1)')!;
  console.log(`${songs} files: ${main} songs (main copies), ${songs - main} extra copies. ${multi.groups} songs have more than one copy (${multi.copies} files).`);
  console.log('\nThe most copies:');
  for (const k of db.all<{ version_key: string }>('SELECT version_key FROM songs GROUP BY version_key ORDER BY COUNT(*) DESC LIMIT 5')) show(k.version_key);
}
db.close();
