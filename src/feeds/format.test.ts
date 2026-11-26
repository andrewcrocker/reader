import { describe, expect, it } from 'vitest';
import { ago, shortDate } from './format';

describe('ago', () => {
  const now = Date.UTC(2026, 10, 26, 12);
  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 m ago'],
    [59 * 60_000, '59 m ago'],
    [60 * 60_000, '1 h ago'],
    [23 * 3_600_000, '23 h ago'],
    [24 * 3_600_000, '1 d ago'],
    [5 * 86_400_000, '5 d ago'],
  ])('%i ms -> %s', (ms, text) => expect(ago(now - ms, now)).toBe(text));
});

describe('shortDate', () => {
  const now = Date.UTC(2026, 10, 27, 12);

  it('shows a date-only post on its own day whatever the time zone', () => {
    // Midnight UTC is how a feed's "Thu, 26 Nov 2026" arrives. West of Greenwich that would be the 25th.
    expect(shortDate(Date.UTC(2026, 10, 26), now)).toMatch(/\b26\b/);
  });

  it('adds the year only when it is not this year', () => {
    expect(shortDate(Date.UTC(2026, 9, 31), now)).not.toMatch(/2026/);
    expect(shortDate(Date.UTC(2025, 9, 31), now)).toMatch(/2025/);
  });
});
