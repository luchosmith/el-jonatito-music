// A small typed middleware + router layer on top of node:http.
// Chosen over Express/Fastify to keep the server dependency-free for a
// home server (no native builds, tiny attack surface).
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body?: unknown;
  raw?: Buffer;
  /** set when a handler already wrote the response (files, SSE) */
  handled?: boolean;
}

export type Middleware = (ctx: Ctx, next: () => Promise<unknown>) => Promise<unknown>;
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  chain: Middleware[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  private globals: Middleware[] = [];

  use(mw: Middleware) {
    this.globals.push(mw);
  }

  add(method: string, pattern: string, ...fns: [...Middleware[], Handler]) {
    // Two routes on one path would silently shadow each other (the first one wins).
    const shape = (p: string) => p.split('/').filter(Boolean).map((x) => (x.startsWith(':') ? ':' : x)).join('/');
    if (this.routes.some((r) => r.method === method && r.parts.map((x) => (x.startsWith(':') ? ':' : x)).join('/') === shape(pattern))) {
      throw new Error(`Route registered twice: ${method} ${pattern}`);
    }
    const handler = fns.pop() as Handler;
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), chain: fns as Middleware[], handler });
  }
  get(p: string, ...f: [...Middleware[], Handler]) { this.add('GET', p, ...f); }
  post(p: string, ...f: [...Middleware[], Handler]) { this.add('POST', p, ...f); }
  put(p: string, ...f: [...Middleware[], Handler]) { this.add('PUT', p, ...f); }
  patch(p: string, ...f: [...Middleware[], Handler]) { this.add('PATCH', p, ...f); }
  delete(p: string, ...f: [...Middleware[], Handler]) { this.add('DELETE', p, ...f); }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const segs = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  /** Returns false when no route matched (caller may serve static files). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://local');
    const found = this.match(req.method ?? 'GET', url.pathname);
    if (!found) return false;
    const ctx: Ctx = { req, res, url, params: found.params };
    const chain = [...this.globals, ...found.route.chain];
    try {
      let i = 0;
      const next = async (): Promise<unknown> => {
        const mw = chain[i++];
        return mw ? mw(ctx, next) : found.route.handler(ctx);
      };
      const out = await next();
      if (!ctx.handled && !res.writableEnded) sendJson(res, 200, out ?? { ok: true });
    } catch (err) {
      if (res.headersSent) { res.end(); return true; }
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message, ...err.extra });
      else {
        console.error(err);
        sendJson(res, 500, { error: 'Internal error' });
      }
    }
    return true;
  }
}

/** JSON; gzipped when it is big and the client takes gzip (the whole library is a few MB). */
export function sendJson(res: ServerResponse, status: number, body: unknown) {
  let data: string | Buffer = JSON.stringify(body);
  const headers: Record<string, string | number> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (data.length > 16 * 1024 && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''))) {
    data = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = Buffer.byteLength(data);
  res.writeHead(status, headers);
  res.end(data);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parses a JSON body (max 64 KB). */
export const jsonBody: Middleware = async (ctx, next) => {
  const buf = await readBody(ctx.req, 64 * 1024);
  try {
    ctx.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  return next();
};

/** Reads a binary upload (photo / voice) whose Content-Type starts with one of `types`. */
export function rawBody(types: string[], limitBytes: number): Middleware {
  return async (ctx, next) => {
    const ct = (ctx.req.headers['content-type'] ?? '').toLowerCase();
    if (!types.some((t) => ct.startsWith(t))) throw new HttpError(415, `Expected ${types.join(' or ')}`);
    ctx.raw = await readBody(ctx.req, limitBytes);
    if (ctx.raw.length === 0) throw new HttpError(400, 'Empty upload');
    return next();
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.webmanifest': 'application/manifest+json',
};

export function mimeOf(file: string) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Streams a file with HTTP Range support (audio / video seeking). */
export function sendFile(ctx: Ctx, file: string, cache = 'private, max-age=3600') {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Not found');
  const { size } = fs.statSync(file);
  const type = mimeOf(file);
  const range = ctx.req.headers.range;
  ctx.handled = true;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    ctx.res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': cache,
    });
    fs.createReadStream(file, { start, end }).pipe(ctx.res);
  } else {
    ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(ctx.res);
  }
}

/** Resolves `name` inside `dir`, refusing path traversal. */
export function safeJoin(dir: string, name: string): string {
  const p = path.resolve(dir, name);
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new HttpError(400, 'Bad path');
  return p;
}
