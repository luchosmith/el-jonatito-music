// Measures the loudness of library songs not measured yet, so the player can even out their volume.
// It decodes every file, so the first run over a big library takes hours; stop it any time (Ctrl+C) and
// run it again later: it goes on where it was.
// Usage: npm run library:loudness [-- <how many>]
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { measureLibrary } from './library.ts';

const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
const { done, failed } = await measureLibrary(db, cfg, { limit, log: (m) => console.log(m) });
console.log(`${done} songs measured${failed ? ` (${failed} could not be)` : ''}.`);
db.close();
