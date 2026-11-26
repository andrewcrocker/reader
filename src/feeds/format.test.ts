import { describe, expect, it } from 'vitest';
import { ago, feedHost, shortDate } from './format';

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

describe('feedHost', () => {
  it('prefers the host the posts are rebased onto, so a moved blog shows where it is read', () => {
    expect(feedHost({ feedUrl: 'https://vitalik.eth.limo/feed.xml', siteUrl: 'https://vitalik.ca/', linkBase: 'https://vitalik.eth.limo' })).toBe('vitalik.eth.limo');
  });

  it('falls back to the site, then to the feed address', () => {
    expect(feedHost({ feedUrl: 'https://example.com/feed.xml', siteUrl: 'https://blog.example.com/', linkBase: null })).toBe('blog.example.com');
    expect(feedHost({ feedUrl: 'https://example.com/feed.xml', siteUrl: 'https://blog.example.com/' })).toBe('blog.example.com');
    expect(feedHost({ feedUrl: 'https://example.com/feed.xml' })).toBe('example.com');
  });

  it('drops www. and the path', () => {
    expect(feedHost({ feedUrl: 'https://www.example.com/a/b/feed.xml', siteUrl: 'https://www.example.com/a/b/' })).toBe('example.com');
  });

  it('skips an address that does not parse', () => {
    expect(feedHost({ feedUrl: 'https://example.com/feed.xml', siteUrl: 'not a url' })).toBe('example.com');
  });
});
