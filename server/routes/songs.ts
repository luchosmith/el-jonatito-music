// The songs for the player, the audio files themselves (from wherever they are: the NAS or the uploads
// folder) and their covers. The sleep lock is enforced on the server.
import path from 'node:path';
import type { Deps } from '../app.ts';
import { HttpError, jsonBody, safeJoin, sendFile } from '../http.ts';
import { PLAYABLE_CODECS, songCover, songFile } from '../library.ts';
import { rebuildVersions } from '../versions.ts';
import { bool, obj } from '../validate.ts';
import { inWindow, minutesOfDay, startOfDay } from '../../shared/time.ts';
import type { SongList } from '../../shared/types.ts';

/** Every song plays at about -16 LUFS: how many dB to turn this one down (or up), when it is known. */
export function gainDb(s: { normalized: number; loudness_lufs: number | null; rg_track_gain: number | null }): number | null {
  if (s.normalized) return 0;
  if (s.loudness_lufs !== null && s.loudness_lufs > -70) return Math.round((-16 - s.loudness_lufs) * 10) / 10;
  if (s.rg_track_gain !== null) return Math.round((s.rg_track_gain + 2) * 10) / 10; // ReplayGain aims at -18 LUFS
  return null;
}

export function songRoutes({ router, db, cfg, now }: Deps) {
  const lockState = () => {
    const p = cfg.sleep;
    const t = now();
    if (!p || !inWindow(minutesOfDay(t), p.start_min, p.end_min)) return { locked: false, unlock_at: null };
    const u = startOfDay(t);
    u.setMinutes(p.end_min);
    if (u <= t) u.setDate(u.getDate() + 1);
    return { locked: true, unlock_at: u.toISOString() };
  };

  /**
   * The songs the player can play: one copy of each (the main one), hidden ones too with ?all=1. Missing files and
   * formats browsers can't play are left out.
   */
  router.get('/api/songs', (ctx): SongList => {
    const all = ctx.url.searchParams.get('all') === '1';
    const songs = db.all<{ id: number; title: string; artist: string | null; album: string | null; hidden: number; cover: string | null; embedded_cover: number;
      folder_cover: string | null; normalized: number; loudness_lufs: number | null; rg_track_gain: number | null }>(
      `SELECT s.id, s.title, s.artist, s.album, s.hidden, s.cover, s.embedded_cover, s.folder_cover, s.normalized, s.loudness_lufs, s.rg_track_gain
       FROM songs s JOIN roots r ON r.id = s.root_id
       WHERE s.missing = 0 AND s.is_main = 1 AND (r.kind = 'uploads' OR s.codec IN (${PLAYABLE_CODECS.map(() => '?').join(',')})) ${all ? '' : 'AND s.hidden = 0'}
       ORDER BY s.id`, ...PLAYABLE_CODECS,
    ).map((s) => ({
      id: s.id, title: s.title, artist: s.artist, album: s.album,
      cover_url: s.cover || (s.cover === null && (s.embedded_cover || s.folder_cover)) ? `/api/songs/${s.id}/cover` : null,
      audio_url: `/api/songs/${s.id}/file`, hidden: !!s.hidden, gain_db: gainDb(s),
    }));
    return { songs, ...lockState() };
  });

  /**
   * { hidden }: hide a song, every copy of it (or show it again). { main: true }: this copy is the one the player
   * plays, whatever the rules would pick.
   */
  router.patch('/api/songs/:id', jsonBody, (ctx) => {
    const id = Number(ctx.params.id);
    const song = db.get<{ version_key: string | null }>('SELECT version_key FROM songs WHERE id = ?', id);
    if (!song) throw new HttpError(404, 'Unknown song');
    const body = obj(ctx.body);
    const hidden = bool(body, 'hidden');
    const main = bool(body, 'main');
    if (hidden === undefined && main !== true) throw new HttpError(400, 'hidden or main: true is required');
    const copies = song.version_key ? 'version_key = ?' : 'id = ?';
    const of = song.version_key ?? id;
    db.tx(() => {
      if (hidden !== undefined) db.run(`UPDATE songs SET hidden = ? WHERE ${copies}`, hidden ? 1 : 0, of);
      if (main) {
        db.run(`UPDATE songs SET preferred = 0 WHERE ${copies}`, of);
        db.run('UPDATE songs SET preferred = 1 WHERE id = ?', id);
      }
    });
    if (main) rebuildVersions(db, PLAYABLE_CODECS);
    return { id, ...(hidden !== undefined ? { hidden } : {}), ...(main ? { main } : {}) };
  });

  /** Every copy of the song (the main one first): where each is, its format and album. */
  router.get('/api/songs/:id/versions', (ctx) => {
    const id = Number(ctx.params.id);
    const song = db.get<{ version_key: string | null }>('SELECT version_key FROM songs WHERE id = ?', id);
    if (!song) throw new HttpError(404, 'Unknown song');
    return db.all<{ id: number; title: string; artist: string | null; album: string | null; year: number | null; codec: string | null; bitrate: number | null;
      duration_s: number | null; is_main: number; preferred: number; missing: number; root: string; path: string }>(
      `SELECT s.id, s.title, s.artist, s.album, s.year, s.codec, s.bitrate, s.duration_s, s.is_main, s.preferred, s.missing, r.name AS root, s.path
       FROM songs s JOIN roots r ON r.id = s.root_id WHERE ${song.version_key ? 's.version_key = ?' : 's.id = ?'} ORDER BY s.is_main DESC, s.id`,
      song.version_key ?? id,
    ).map(({ is_main, preferred, missing, ...v }) => ({ ...v, main: !!is_main, preferred: !!preferred, missing: !!missing }));
  });

  // The song itself. The sleep lock applies here too, so a saved link can't get around it.
  router.get('/api/songs/:id/file', (ctx) => {
    const file = songFile(db, cfg, Number(ctx.params.id));
    const lock = lockState();
    if (lock.locked) throw new HttpError(423, 'Music is sleeping', { unlock_at: lock.unlock_at });
    sendFile(ctx, file, 'private, max-age=86400');
  });

  router.get('/api/songs/:id/cover', async (ctx) => {
    const name = await songCover(db, cfg, Number(ctx.params.id));
    if (!name) throw new HttpError(404, 'No cover');
    sendFile(ctx, safeJoin(path.join(cfg.uploadsDir, 'covers'), name), 'private, max-age=86400');
  });
}
