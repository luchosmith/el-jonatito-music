// The song library. Imported from a folder of audio files: the name and artist come from the file's
// tags (or its file name), the cover art is taken out of the file when it has one, and the loudness is
// evened out so every song plays at the same volume (no sudden loud songs).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

// FLAC and WAV are fine too: every song is turned into an evened-out MP3 on the way in.
const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.webm', '.flac', '.wav'];

interface Tags { title?: string; artist?: string }

function tagsOf(file: string): Tags {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=title,artist', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) return {};
  const t = (JSON.parse(r.stdout || '{}').format?.tags ?? {}) as Record<string, string>;
  const low = Object.fromEntries(Object.entries(t).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  return { title: low.title || undefined, artist: low.artist || undefined };
}

/** "01 - Dura.mp3" -> "Dura"; "aha - take on me" (no artist tag) -> artist "aha", title "take on me". */
export function songName(fileName: string, tags: Tags): { title: string; artist: string | null } {
  let title = (tags.title ?? path.parse(fileName).name).replace(/^\d{1,3}\s*[-.]?\s*/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  let artist = tags.artist ?? null;
  if (!artist && title.includes(' - ')) {
    const parts = title.split(' - ');
    artist = parts[0].trim();
    title = parts[parts.length - 1].trim();
  }
  return { title: title || path.parse(fileName).name, artist };
}

/** The file's embedded picture as a 300 px square JPEG in uploads/covers, or null. */
function extractCover(src: string, uploadsDir: string): string | null {
  const dir = path.join(uploadsDir, 'covers');
  fs.mkdirSync(dir, { recursive: true });
  const name = `song-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-an', '-frames:v', '1',
    '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', path.join(dir, name)]);
  return r.status === 0 && fs.existsSync(path.join(dir, name)) ? name : null;
}

/** The loudness target (EBU R128, like streaming services), the true-peak ceiling and the loudness range. */
const LOUDNORM = 'I=-16:TP=-1.5:LRA=11';

/**
 * Evens out a song's loudness: pass 1 measures it, pass 2 changes the volume by one fixed amount (linear, so
 * the music keeps its own dynamics) with a limiter on the peaks. Writes an MP3 at `dest`; false if it failed.
 */
export function normalizeAudio(src: string, dest: string): boolean {
  const m = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-map', '0:a:0', '-af', `loudnorm=${LOUDNORM}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(m.stderr ?? '');
  if (m.status !== 0 || !json) return false;
  const v = JSON.parse(json[0]) as Record<string, string>;
  if (!Number.isFinite(Number(v.input_i))) return false; // silence: nothing to even out
  const af = `loudnorm=${LOUDNORM}:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-af', af, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1', dest]);
  return r.status === 0 && fs.existsSync(dest);
}

/** Evens out the songs imported before this existed (or whose first try failed). Returns how many were done. */
export function normalizeSongs(db: Db, cfg: Config, log: (msg: string) => void = () => undefined): { done: number; failed: number } {
  const dir = path.join(cfg.uploadsDir, 'songs');
  let done = 0;
  let failed = 0;
  for (const s of db.all<{ id: number; title: string; file: string }>('SELECT id, title, file FROM songs WHERE normalized = 0 ORDER BY id')) {
    const file = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp3`;
    if (normalizeAudio(path.join(dir, s.file), path.join(dir, file))) {
      db.run('UPDATE songs SET file = ?, normalized = 1 WHERE id = ?', file, s.id);
      fs.rmSync(path.join(dir, s.file), { force: true });
      done++;
      log(`✓ ${s.title}`);
    } else {
      failed++;
      log(`✗ ${s.title} (kept as it was)`);
    }
  }
  return { done, failed };
}

/** "Tutti Frutti", "tutti-frutti" and "Tuttí Frutti" are the same song: lower case, no accents, letters and digits only. */
export const songKey = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Imports every audio file in `dir` that is not in the list yet: not the same file (by name), and not the
 * same song (same title and artist, e.g. a copy from another folder). Returns how many were added.
 */
export function importSongs(db: Db, cfg: Config, dir: string): { added: number; skipped: number } {
  const files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())).sort();
  const songsDir = path.join(cfg.uploadsDir, 'songs');
  fs.mkdirSync(songsDir, { recursive: true });
  let added = 0;
  let skipped = 0;
  for (const f of files) {
    if (db.get('SELECT 1 FROM songs WHERE source = ?', f)) {
      skipped++;
      continue;
    }
    const src = path.join(dir, f);
    const { title, artist } = songName(f, tagsOf(src));
    const same = db.all<{ title: string; artist: string | null }>('SELECT title, artist FROM songs')
      .some((s) => songKey(s.title) === songKey(title) && (!s.artist || !artist || songKey(s.artist) === songKey(artist)));
    if (same) {
      skipped++;
      continue;
    }
    // Evened out on the way in; if that fails, the file is copied as it is (and can be evened out later).
    let file = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp3`;
    const normalized = normalizeAudio(src, path.join(songsDir, file));
    if (!normalized) {
      file = file.replace(/\.mp3$/, path.extname(f).toLowerCase());
      fs.copyFileSync(src, path.join(songsDir, file));
    }
    db.run('INSERT INTO songs(title, artist, file, cover, source, normalized, added_at) VALUES(?,?,?,?,?,?,?)',
      title, artist, file, extractCover(src, cfg.uploadsDir), f, normalized ? 1 : 0, new Date().toISOString());
    added++;
  }
  return { added, skipped };
}
