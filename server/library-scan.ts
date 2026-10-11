// Scans a library folder (e.g. the NAS) into the database: a row per audio file, with all its metadata.
// Files are read where they are and never changed. Run it again after adding music: only new and changed
// files are read.
// Usage: npm run library:scan -- <folder>     (adds the folder the first time)
//        npm run library:scan                 (scans every folder added before)
import { loadConfig } from './config.ts';
import { Db } from './db.ts';
import { addRoot, scanRoot, type Root } from './library.ts';

const cfg = loadConfig();
const db = new Db(cfg.dbFile);
const [dir] = process.argv.slice(2);
const roots = dir ? [addRoot(db, dir)] : db.all<Root>("SELECT * FROM roots WHERE kind = 'folder' ORDER BY id");
if (!roots.length) {
  console.error('Usage: npm run library:scan -- <folder>');
  process.exit(1);
}
let failed = false;
for (const root of roots) {
  const t0 = Date.now();
  try {
    const r = await scanRoot(db, root, { log: (m) => console.log(m) });
    console.log(`${root.path}: ${r.files} files: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged, ${r.missing} gone (marked missing). ${Math.round((Date.now() - t0) / 1000)} s.`);
  } catch (e) {
    console.error(`${root.path}: ${(e as Error).message}`);
    failed = true;
  }
}
db.close();
process.exit(failed ? 1 : 0);
