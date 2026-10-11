// The song library and the audio files themselves (with the sleep lock enforced on the server).
import path from 'node:path';
import type { Deps } from '../app.ts';
import { HttpError, jsonBody, safeJoin, sendFile } from '../http.ts';
import { bool, obj } from '../validate.ts';
import { inWindow, minutesOfDay, startOfDay } from '../../shared/time.ts';
import type { SongList } from '../../shared/types.ts';

export const coverUrl = (file: string | null) => (file ? `/api/covers/${encodeURIComponent(file)}` : null);

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

  /** The songs (hidden ones too with ?all=1). */
  router.get('/api/songs', (ctx): SongList => {
    const all = ctx.url.searchParams.get('all') === '1';
    const songs = db.all<{ id: number; title: string; artist: string | null; cover: string | null; hidden: number }>(
      `SELECT id, title, artist, cover, hidden FROM songs ${all ? '' : 'WHERE hidden = 0'} ORDER BY id`,
    ).map((s) => ({ id: s.id, title: s.title, artist: s.artist, cover_url: coverUrl(s.cover), audio_url: `/api/songs/${s.id}/file`, hidden: !!s.hidden }));
    return { songs, ...lockState() };
  });

  /** Hide a song (or show it again). */
  router.patch('/api/songs/:id', jsonBody, (ctx) => {
    const id = Number(ctx.params.id);
    if (!db.get('SELECT 1 FROM songs WHERE id = ?', id)) throw new HttpError(404, 'Unknown song');
    const hidden = bool(obj(ctx.body), 'hidden');
    if (hidden === undefined) throw new HttpError(400, 'hidden is required');
    db.run('UPDATE songs SET hidden = ? WHERE id = ?', hidden ? 1 : 0, id);
    return { id, hidden };
  });

  // The song itself. The sleep lock applies here too, so a saved link can't get around it.
  router.get('/api/songs/:id/file', (ctx) => {
    const s = db.get<{ file: string }>('SELECT file FROM songs WHERE id = ?', Number(ctx.params.id));
    if (!s) throw new HttpError(404, 'Unknown song');
    const lock = lockState();
    if (lock.locked) throw new HttpError(423, 'Music is sleeping', { unlock_at: lock.unlock_at });
    sendFile(ctx, safeJoin(path.join(cfg.uploadsDir, 'songs'), s.file), 'private, max-age=86400');
  });

  router.get('/api/covers/:file', (ctx) => {
    sendFile(ctx, safeJoin(path.join(cfg.uploadsDir, 'covers'), ctx.params.file), 'private, max-age=86400');
  });
}
