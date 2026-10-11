// Tiny input validators (keeps the server dependency-free).
import { HttpError } from './http.ts';

type Obj = Record<string, unknown>;

export function obj(v: unknown): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Expected a JSON object');
  return v as Obj;
}

export function str(o: Obj, key: string, opts: { optional?: boolean; max?: number; pattern?: RegExp } = {}): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new HttpError(400, `${key} is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
  if (v.length > (opts.max ?? 200)) throw new HttpError(400, `${key} is too long`);
  if (opts.pattern && !opts.pattern.test(v)) throw new HttpError(400, `${key} is invalid`);
  return v;
}

export function num(o: Obj, key: string, opts: { optional?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new HttpError(400, `${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new HttpError(400, `${key} must be a number`);
  if (opts.min !== undefined && v < opts.min) throw new HttpError(400, `${key} is too small`);
  if (opts.max !== undefined && v > opts.max) throw new HttpError(400, `${key} is too large`);
  return v;
}

export function bool(o: Obj, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `${key} must be true or false`);
  return v;
}

export function oneOf<T extends string>(o: Obj, key: string, values: readonly T[], optional = false): T | undefined {
  const v = str(o, key, { optional });
  if (v === undefined) return undefined;
  if (!values.includes(v as T)) throw new HttpError(400, `${key} must be one of ${values.join(', ')}`);
  return v as T;
}
