import type { ReactNode } from 'react';

// The one clock face used for every time shown to Jonatito: a regular 12-hour dial,
// hands at the target time, and the span between `from` and the target shaded.
// Waits up to 60 minutes are shaded on the minute scale, longer ones on the hour scale.
interface Props {
  at: Date;
  from?: Date | null;
  size?: number;
  numbers?: boolean;
  testId?: string;
}

const R = 42;
const point = (deg: number): [number, number] => [50 + R * Math.sin((deg * Math.PI) / 180), 50 - R * Math.cos((deg * Math.PI) / 180)];

export function Clock12({ at, from, size = 40, numbers, testId }: Props) {
  let wedge: ReactNode = null;
  if (from) {
    const spanMin = (at.getTime() - from.getTime()) / 60_000;
    let a0: number;
    let a1: number;
    if (Math.abs(spanMin) <= 60) {
      a0 = from.getMinutes() * 6 + from.getSeconds() / 10;
      a1 = a0 + spanMin * 6;
    } else {
      a0 = ((from.getHours() % 12) + from.getMinutes() / 60) * 30;
      a1 = a0 + spanMin / 2;
    }
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    if (hi - lo > 0.5) {
      const [x0, y0] = point(lo);
      const [x1, y1] = point(hi);
      wedge = <path d={`M50 50 L${x0} ${y0} A${R} ${R} 0 ${hi - lo > 180 ? 1 : 0} 1 ${x1} ${y1} Z`} fill="#ffd166" opacity={0.8} />;
    }
  }
  const hourDeg = ((at.getHours() % 12) + at.getMinutes() / 60) * 30;
  const minDeg = at.getMinutes() * 6;
  const showNumbers = numbers ?? size >= 100;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="clock12" data-testid={testId} role="img"
      aria-label={`${at.getHours() % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')}`}>
      <circle cx="50" cy="50" r="46" fill="#fff" stroke="#1f2a37" strokeWidth="5" />
      {wedge}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="6" x2="50" y2={showNumbers ? (i % 3 ? 9 : 11) : i % 3 ? 12 : 15} stroke="#1f2a37" strokeWidth={i % 3 ? 2 : 4} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {/* all twelve numbers, like the clock on his wall */}
      {showNumbers &&
        Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <text key={n} x={50 + 32 * Math.sin((n * Math.PI) / 6)} y={50 - 32 * Math.cos((n * Math.PI) / 6)} dy="0.36em"
            fontSize="13" fontWeight="800" textAnchor="middle" fill="#1f2a37">{n}</text>
        ))}
      <line x1="50" y1="50" x2="50" y2="26" stroke="#1f2a37" strokeWidth="7" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="14" stroke="#5aa4e6" strokeWidth="5" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
      <circle cx="50" cy="50" r="5" fill="#e45757" />
    </svg>
  );
}
