// The music library: folders of audio files (e.g. a NAS share) read in place, never written to. A scan walks
// a folder and keeps one database row per audio file, duplicates included, with all its metadata and where
// it is. Scanning again only reads files that are new or changed (by size and modified time); files that are
// gone are marked missing.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { rebuildGenres } from './genres.ts';
import { HttpError, safeJoin } from './http.ts';
import { coverArgs, songName } from './songs.ts';

export const AUDIO_EXT = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma', '.ape', '.wv', '.webm'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png'];

/** What browsers can play (Chrome, Firefox, Safari): other files are in the library but not in the player. */
export const PLAYABLE_CODECS = ['mp3', 'flac', 'aac', 'vorbis', 'opus', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le'];

/** Synology's @eaDir and #recycle, and hidden files (incl. macOS "._" copies) are not music. */
const skipName = (name: string) => name.startsWith('@') || name.startsWith('#') || name.startsWith('.');

export interface Root { id: number; kind: 'folder' | 'uploads'; path: string | null; name: string }

/** The folder a root's paths are relative to. */
export const rootDir = (cfg: Config, root: Root) => (root.kind === 'uploads' ? path.join(cfg.uploadsDir, 'songs') : root.path!);

/** The root for this folder (added the first time). */
export function addRoot(db: Db, dir: string): Root {
  const abs = path.resolve(dir);
  const found = db.get<Root>("SELECT * FROM roots WHERE kind = 'folder' AND path = ?", abs);
  if (found) return found;
  const id = db.run("INSERT INTO roots(kind, path, name, added_at) VALUES('folder', ?, ?, ?)", abs, path.basename(abs), new Date().toISOString()).lastId;
  return db.get<Root>('SELECT * FROM roots WHERE id = ?', id)!;
}

/** Where a song's file is on disk. */
export function songFile(db: Db, cfg: Config, id: number): string {
  const s = db.get<Root & { rel: string }>('SELECT r.*, s.path AS rel FROM songs s JOIN roots r ON r.id = s.root_id WHERE s.id = ?', id);
  if (!s) throw new HttpError(404, 'Unknown song');
  return safeJoin(rootDir(cfg, s), s.rel);
}

// ---- Reading a file ------------------------------------------------------------------------------

function run(cmd: string, args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    p.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    p.on('error', () => resolve({ status: null, stdout }));
    p.on('close', (status) => resolve({ status, stdout }));
  });
}

/** Runs `fn` over `items`, `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export interface Meta {
  title: string; artist: string | null; album: string | null; album_artist: string | null;
  track_no: number | null; track_total: number | null; disc_no: number | null; disc_total: number | null;
  year: number | null; genre: string | null; composer: string | null; tags: string | null;
  duration_s: number | null; format: string | null; codec: string | null; bitrate: number | null;
  sample_rate: number | null; channels: number | null; bit_depth: number | null;
  rg_track_gain: number | null; rg_album_gain: number | null; embedded_cover: number;
}

const int = (v: string | undefined) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : null;
};
const float = (v: string | number | undefined) => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

interface Probe {
  format?: { format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string> };
  streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; bits_per_raw_sample?: string; bits_per_sample?: number;
    duration?: string; bit_rate?: string; disposition?: { attached_pic?: number }; tags?: Record<string, string> }[];
}

/** The metadata ffprobe finds in the file (tag names vary by format: TITLE, title, ALBUMARTIST, album_artist ...). */
export function metaFromProbe(fileName: string, p: Probe): Meta {
  const audio = p.streams?.find((s) => s.codec_type === 'audio');
  const raw: Record<string, string> = { ...(p.format?.tags ?? {}), ...(audio?.tags ?? {}) };
  const t: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (typeof v === 'string' && v.trim() && !(key in t)) t[key] = v.trim();
  }
  const [trackNo, trackTotal] = (t.track ?? t.tracknumber ?? '').split('/');
  const [discNo, discTotal] = (t.disc ?? t.discnumber ?? '').split('/');
  const fromName = songName(fileName, {});
  return {
    title: t.title ?? fromName.title,
    artist: t.artist ?? (t.title ? null : fromName.artist) ?? t.albumartist ?? null,
    album: t.album ?? null,
    album_artist: t.albumartist ?? null,
    track_no: int(trackNo),
    track_total: int(trackTotal) ?? int(t.tracktotal ?? t.totaltracks),
    disc_no: int(discNo),
    disc_total: int(discTotal) ?? int(t.disctotal ?? t.totaldiscs),
    year: int(/\d{4}/.exec(t.date ?? t.year ?? t.originaldate ?? '')?.[0]),
    genre: t.genre ?? null,
    composer: t.composer ?? null,
    tags: Object.keys(raw).length ? JSON.stringify(raw) : null,
    duration_s: float(p.format?.duration ?? audio?.duration),
    format: p.format?.format_name ?? null,
    codec: audio?.codec_name ?? null,
    bitrate: int(p.format?.bit_rate ?? audio?.bit_rate),
    sample_rate: int(audio?.sample_rate),
    channels: audio?.channels ?? null,
    bit_depth: int(audio?.bits_per_raw_sample) || audio?.bits_per_sample || null,
    rg_track_gain: float(t.replaygaintrackgain),
    rg_album_gain: float(t.replaygainalbumgain),
    embedded_cover: p.streams?.some((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1) ? 1 : 0,
  };
}

export async function probe(file: string): Promise<Meta> {
  const r = await run('ffprobe', ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', file]);
  let p: Probe = {};
  try {
    if (r.status === 0) p = JSON.parse(r.stdout) as Probe;
  } catch { /* unreadable: it still gets a row, named after its file, with no codec */ }
  return metaFromProbe(path.basename(file), p);
}

/** sha256 of the size and the first and last 64 KB: cheap over the network, the same for identical files. */
export async function quickHash(file: string, size: number): Promise<string> {
  const h = crypto.createHash('sha256').update(String(size));
  const chunk = 64 * 1024;
  const parts = size > 2 * chunk ? [[0, chunk], [size - chunk, chunk]] : [[0, size]];
  const fd = await fs.promises.open(file, 'r');
  try {
    for (const [at, len] of parts) {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fd.read(buf, 0, len, at);
      h.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fd.close();
  }
  return h.digest('hex');
}

// ---- Scanning ------------------------------------------------------------------------------------

/** The folder's own picture: cover / folder / front first, then anything with "cover" or "front", then the first one. */
export function pickCover(images: string[]): string | null {
  if (!images.length) return null;
  const by = (re: RegExp) => images.find((f) => re.test(path.parse(f).name));
  return by(/^(cover|folder|front)$/i) ?? by(/cover|front|folder/i) ?? (images.find((f) => !/back|cd|disc|inlay|inside/i.test(f)) ?? null);
}

/** Every audio file under `dir` (relative paths), with the folder picture for each (a disc folder uses its album's). */
async function walk(dir: string): Promise<{ rel: string; folderCover: string | null }[]> {
  const out: { rel: string; folderCover: string | null }[] = [];
  const visit = async (rel: string, parentCover: string | null) => {
    const entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
    const ext = (n: string) => path.extname(n).toLowerCase();
    const own = pickCover(entries.filter((e) => e.isFile() && !skipName(e.name) && IMAGE_EXT.includes(ext(e.name))).map((e) => e.name).sort());
    const cover = !rel ? null : own ? path.join(rel, own) : parentCover; // a picture at the very top is no album's
    for (const e of entries) {
      if (skipName(e.name)) continue;
      if (e.isFile() && AUDIO_EXT.includes(ext(e.name))) out.push({ rel: path.join(rel, e.name), folderCover: cover });
    }
    // A sub-folder (Disc 1, CD2 ...) may use this folder's picture, but nothing uses the root's.
    for (const e of entries) if (e.isDirectory() && !skipName(e.name)) await visit(path.join(rel, e.name), cover);
  };
  await visit('', null);
  return out;
}

const COLS = ['title', 'artist', 'album', 'album_artist', 'track_no', 'track_total', 'disc_no', 'disc_total', 'year', 'genre', 'composer', 'tags',
  'duration_s', 'format', 'codec', 'bitrate', 'sample_rate', 'channels', 'bit_depth', 'rg_track_gain', 'rg_album_gain', 'embedded_cover'] as const;

export interface ScanResult { files: number; added: number; updated: number; unchanged: number; missing: number }

/**
 * Scans a library folder into the database. `log` gets progress lines. Refuses to mark everything missing
 * when the folder looks empty (e.g. the NAS is not mounted).
 */
export async function scanRoot(db: Db, root: Root, opts: { concurrency?: number; log?: (msg: string) => void } = {}): Promise<ScanResult> {
  if (root.kind !== 'folder' || !root.path) throw new Error('Only library folders are scanned');
  const log = opts.log ?? (() => undefined);
  const dir = root.path;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not there (is the NAS mounted?)`);
  const stamp = new Date().toISOString();
  log(`Looking for audio files in ${dir} ...`);
  const files = await walk(dir);
  const known = new Map(db.all<{ id: number; path: string; size: number | null; mtime: string | null; missing: number }>(
    'SELECT id, path, size, mtime, missing FROM songs WHERE root_id = ?', root.id).map((s) => [s.path, s]));
  if (!files.length && known.size) throw new Error(`${dir} has no audio files but the library has ${known.size}: is the NAS mounted? Nothing changed.`);
  log(`${files.length} audio files (${known.size} already in the library). Reading the new and changed ones ...`);

  const res: ScanResult = { files: files.length, added: 0, updated: 0, unchanged: 0, missing: 0 };
  // Writes go in batches (one transaction each), while up to `concurrency` files are being read.
  let pending: (() => void)[] = [];
  const flush = () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    db.tx(() => batch.forEach((w) => w()));
  };
  let done = 0;
  await pool(files, opts.concurrency ?? 8, async ({ rel, folderCover }) => {
    const abs = path.join(dir, rel);
    try {
      const st = await fs.promises.stat(abs);
      const mtime = st.mtime.toISOString();
      const old = known.get(rel);
      if (old && old.size === st.size && old.mtime === mtime) {
        res.unchanged++;
        pending.push(() => db.run('UPDATE songs SET scanned_at = ?, missing = 0, folder_cover = ? WHERE id = ?', stamp, folderCover, old.id));
      } else {
        const [meta, hash] = await Promise.all([probe(abs), quickHash(abs, st.size)]);
        const values = COLS.map((c) => meta[c]);
        if (old) {
          res.updated++;
          pending.push(() => db.run(`UPDATE songs SET ${COLS.map((c) => `${c} = ?`).join(', ')}, size = ?, mtime = ?, quick_hash = ?, folder_cover = ?, cover = NULL, missing = 0, scanned_at = ? WHERE id = ?`,
            ...values, st.size, mtime, hash, folderCover, stamp, old.id));
        } else {
          res.added++;
          pending.push(() => db.run(`INSERT INTO songs(root_id, path, ${COLS.join(', ')}, size, mtime, quick_hash, folder_cover, added_at, scanned_at) VALUES(${Array(COLS.length + 8).fill('?').join(',')})`,
            root.id, rel, ...values, st.size, mtime, hash, folderCover, stamp, stamp));
        }
      }
    } catch (e) {
      log(`✗ ${rel}: ${(e as Error).message}`);
    }
    if (pending.length >= 200) flush();
    if (++done % 1000 === 0) log(`  ${done} / ${files.length}`);
  });
  flush();
  res.missing = db.run('UPDATE songs SET missing = 1 WHERE root_id = ? AND missing = 0 AND (scanned_at IS NULL OR scanned_at < ?)', root.id, stamp).changes;
  db.run('UPDATE roots SET last_scan_at = ? WHERE id = ?', stamp, root.id);
  rebuildGenres(db);
  return res;
}

// ---- Covers (made the first time they are asked for) ---------------------------------------------

let running = 0;
const waiting: (() => void)[] = [];
const making = new Map<string, Promise<boolean>>();
/**
 * Makes `dest` (a 300 px JPEG) from `src` unless it is there already: ffmpeg at most 6 at a time (a page of
 * covers asks for dozens at once), one job per picture (an album's tracks share theirs), written under a
 * temporary name first so it is never read half-made.
 */
function makeCover(src: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest)) return Promise.resolve(true);
  const inFlight = making.get(dest);
  if (inFlight) return inFlight;
  const job = (async () => {
    while (running >= 6) await new Promise<void>((r) => waiting.push(r));
    running++;
    const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.tmp.jpg`;
    try {
      if ((await run('ffmpeg', coverArgs(src, tmp))).status !== 0 || !fs.existsSync(tmp)) return false;
      fs.renameSync(tmp, dest);
      return true;
    } finally {
      fs.rmSync(tmp, { force: true });
      running--;
      waiting.shift()?.();
      making.delete(dest);
    }
  })();
  making.set(dest, job);
  return job;
}

/**
 * The song's cover as a cached 300 px JPEG in uploads/covers (its file name), or null when it has none:
 * the picture inside the file, else the one in its folder (shared by the whole album).
 */
export async function songCover(db: Db, cfg: Config, id: number): Promise<string | null> {
  const s = db.get<Root & { cover: string | null; embedded_cover: number; folder_cover: string | null; rel: string; quick_hash: string | null }>(
    'SELECT r.*, s.cover, s.embedded_cover, s.folder_cover, s.path AS rel, s.quick_hash FROM songs s JOIN roots r ON r.id = s.root_id WHERE s.id = ?', id); // s.id: the root's
  if (!s) throw new HttpError(404, 'Unknown song');
  if (s.cover !== null) return s.cover || null;
  const dir = path.join(cfg.uploadsDir, 'covers');
  fs.mkdirSync(dir, { recursive: true });
  const base = rootDir(cfg, s);
  let name: string | null = null;
  const own = `song-${id}-${(s.quick_hash ?? '').slice(0, 8)}.jpg`; // a changed file gets a new one
  if (s.embedded_cover && await makeCover(safeJoin(base, s.rel), path.join(dir, own))) name = own;
  if (!name && s.folder_cover) {
    const n = `folder-${crypto.createHash('sha1').update(`${s.id}:${s.folder_cover}`).digest('hex').slice(0, 16)}.jpg`;
    if (await makeCover(safeJoin(base, s.folder_cover), path.join(dir, n))) name = n;
  }
  db.run('UPDATE songs SET cover = ? WHERE id = ?', name ?? '', id);
  return name;
}

// ---- Loudness ------------------------------------------------------------------------------------

/** The file's integrated loudness (LUFS, EBU R128), or null (unreadable, or silence). Decodes the whole file. */
export function measureLoudness(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
    p.on('error', () => resolve(null));
    p.on('close', (status) => {
      const m = /I:\s+(-?[\d.]+) LUFS/.exec(err.split('Summary:').pop() ?? '');
      const v = Number(m?.[1]);
      resolve(status === 0 && m && Number.isFinite(v) && v > -70 ? v : null);
    });
  });
}

/** Measures the songs whose loudness is not known yet (newest scans first is not needed: by id). */
export async function measureLibrary(db: Db, cfg: Config, opts: { limit?: number; concurrency?: number; log?: (msg: string) => void } = {}) {
  const log = opts.log ?? (() => undefined);
  const todo = db.all<{ id: number; title: string }>(
    `SELECT id, title FROM songs WHERE loudness_lufs IS NULL AND normalized = 0 AND missing = 0 AND codec IS NOT NULL ORDER BY id LIMIT ?`, opts.limit ?? -1);
  log(`${todo.length} songs to measure ...`);
  let done = 0;
  let failed = 0;
  await pool(todo, opts.concurrency ?? 4, async (s) => {
    const lufs = await measureLoudness(songFile(db, cfg, s.id));
    if (lufs === null) failed++;
    // -99: tried, could not measure (so it is not tried again every run)
    db.run('UPDATE songs SET loudness_lufs = ? WHERE id = ?', lufs ?? -99, s.id);
    if (++done % 100 === 0) log(`  ${done} / ${todo.length}`);
  });
  return { done, failed };
}
