// Adds a folder of songs to the library (songs already in it are skipped).
// Usage: npm run music:import -- <folder>
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { importSongs } from './songs.ts';

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('Usage: npm run music:import -- <folder>');
  process.exit(1);
}
const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const { added, skipped } = importSongs(db, cfg, dir);
console.log(`${added} songs added${skipped ? `, ${skipped} already there` : ''}. Reload open players to see them.`);
db.close();
