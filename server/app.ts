import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import { ROOT } from './config.ts';
import { Db } from './db.ts';
import { jsonBody, mimeOf, Router, safeJoin, sendJson, HttpError } from './http.ts';
import { clock } from './clock.ts';
import { obj, str } from './validate.ts';
import { songRoutes } from './routes/songs.ts';
import { importSongs } from './songs.ts';
import { addRoot, scanRoot } from './library.ts';

export interface Deps {
  router: Router;
  db: Db;
  cfg: Config;
  now: () => Date;
}

export function createApp(cfg: Config) {
  const db = new Db(cfg.dbFile);
  const router = new Router();
  const deps: Deps = { router, db, cfg, now: () => clock.now() };

  songRoutes(deps);

  router.get('/api/health', () => ({ ok: true }));

  if (cfg.testMode) {
    // Test-only controls, never registered in production.
    router.post('/api/test/reset', () => {
      db.wipe();
      clock.set(null);
      return { ok: true };
    });
    // A few tiny songs for the tests.
    router.post('/api/test/songs', () => importSongs(db, cfg, path.join(ROOT, 'e2e', 'fixtures', 'music')));
    // A small library folder (like the NAS), scanned in place.
    router.post('/api/test/library', () => scanRoot(db, addRoot(db, path.join(ROOT, 'e2e', 'fixtures', 'library'))));
    router.post('/api/test/clock', jsonBody, (ctx) => {
      const iso = str(obj(ctx.body), 'iso', { optional: true, max: 40 });
      clock.set(iso ? new Date(iso) : null);
      return { now: clock.now().toISOString() };
    });
  }

  const indexFile = path.join(cfg.webDist, 'index.html');
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (await router.handle(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      // Static web app (SPA fallback to index.html)
      let file = indexFile;
      if (url.pathname !== '/') {
        try {
          const candidate = safeJoin(cfg.webDist, decodeURIComponent(url.pathname.slice(1)));
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) file = candidate;
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
        }
      }
      if (!fs.existsSync(file)) return sendJson(res, 503, { error: 'Web app not built. Run: npm run build:web' });
      const isAsset = file !== indexFile && url.pathname.startsWith('/assets/');
      res.writeHead(200, {
        'Content-Type': mimeOf(file),
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'",
      });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    }
  });

  return {
    server,
    db,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
