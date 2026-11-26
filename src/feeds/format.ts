const DAY_MS = 86_400_000;

/**
 * "Nov 26", or "Nov 26, 2025" when it isn't this year. A date with no time of day comes through
 * as midnight UTC, so that is read in UTC (it would show the day before west of Greenwich).
 */
export function shortDate(ts: number, now = Date.now()): string {
  const timeZone = ts % DAY_MS === 0 ? 'UTC' : undefined;
  const year = (t: number) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', timeZone });
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone, ...(year(ts) === year(now) ? {} : { year: 'numeric' }) };
  return new Date(ts).toLocaleDateString(undefined, opts);
}

/** "just now", "12 m ago", "3 h ago", "2 d ago". */
export function ago(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
