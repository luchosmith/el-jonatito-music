import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export interface Config {
  port: number;
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  webDist: string;
  testMode: boolean;
  /** The sleep lock: no music between these times (minutes after midnight), or null for none. */
  sleep: { start_min: number; end_min: number } | null;
}

/** "20:30-07:00" -> { start_min: 1230, end_min: 420 }; empty -> null. */
export function parseSleepWindow(s: string | undefined): Config['sleep'] {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`SLEEP_WINDOW must look like 20:30-07:00 (got "${s}")`);
  return { start_min: Number(m[1]) * 60 + Number(m[2]), end_min: Number(m[3]) * 60 + Number(m[4]) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(ROOT, env.DATA_DIR ?? 'data');
  return {
    port: Number(env.PORT ?? 8090),
    dataDir,
    dbFile: path.join(dataDir, env.DB_FILE ?? 'music.sqlite'),
    uploadsDir: path.join(dataDir, 'uploads'),
    webDist: path.join(ROOT, 'web', 'dist'),
    testMode: env.TEST_MODE === '1',
    sleep: parseSleepWindow(env.SLEEP_WINDOW),
  };
}
