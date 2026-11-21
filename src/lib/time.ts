const TZ = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function londonParts(ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of UK local time from UTC at the given instant, in ms (0 in winter, one hour in summer). */
function londonOffset(ms: number): number {
  const p = londonParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Turns a UK local date ("2026-11-23") and time ("07:30") into an epoch time. */
export function londonToEpoch(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  return guess - londonOffset(guess - londonOffset(guess));
}

export function todayLondon(now = Date.now()): string {
  const p = londonParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function fmtTime(ms: number): string {
  const p = londonParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** "2026-11-23" becomes "Mon 23 Nov". */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d))).replace(',', '');
}

export function fmtDur(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtMiles(miles: number): string {
  return miles >= 100 ? `${Math.round(miles)} mi` : `${miles.toFixed(1)} mi`;
}

export const MIN = 60_000;
export const metresToMiles = (m: number) => m / 1609.344;
