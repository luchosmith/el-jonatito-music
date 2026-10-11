// Time helpers. Times are shown on a 12-hour clock.

const pad = (n: number) => String(n).padStart(2, '0');

/** "3:05" — 12-hour, no am/pm. */
export function fmt12(d: Date): string {
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Is `min` (minutes after midnight) inside a window that may wrap midnight? */
export function inWindow(min: number, start: number, end: number): boolean {
  return start <= end ? min >= start && min < end : min >= start || min < end;
}
