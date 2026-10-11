// Evens out the loudness of songs that were not evened out on import, so every song plays at the same volume.
// Usage: npm run music:normalize
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { normalizeSongs } from './songs.ts';

const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const { done, failed } = normalizeSongs(db, cfg, (m) => console.log(m));
console.log(`${done} songs evened out${failed ? `, ${failed} left as they were` : ''}. Reload open players to hear them.`);
db.close();
