import { describe, expect, it } from 'vitest';
import { diffItems, idsToPrune, inboxOrder, isDue, itemId, MIN_CHECK_GAP_MS, newestFirst, urlKey, WINDOW } from './diff';
import type { ParsedItem } from './parse';

const post = (n: number, extra: Partial<ParsedItem> = {}): ParsedItem => ({ link: `https://b.example/${n}`, title: `Post ${n}`, publishedAt: n * 1000, ...extra });
/** Posts 1..n, newest (highest number) first, like a feed. */
const feedOf = (n: number) => Array.from({ length: n }, (_, i) => post(n - i));

describe('itemId', () => {
  it('is the same every time for the same feed and post', () => {
    expect(itemId('feed-1', post(1))).toBe(itemId('feed-1', post(1)));
  });

  it('differs between feeds, and between posts', () => {
    expect(itemId('feed-1', post(1))).not.toBe(itemId('feed-2', post(1)));
    expect(itemId('feed-1', post(1))).not.toBe(itemId('feed-1', post(2)));
  });

  it('keys on the guid when there is one, so a changed link is the same post, and on the link otherwise', () => {
    expect(itemId('f', { guid: 'g-1', link: 'https://b.example/a' })).toBe(itemId('f', { guid: ' g-1 ', link: 'https://b.example/moved' }));
    expect(itemId('f', { link: 'https://b.example/a' })).toBe(itemId('f', { guid: '', link: 'https://b.example/a' }));
    expect(itemId('f', { guid: 'https://b.example/a', link: 'x' })).toBe(itemId('f', { link: 'https://b.example/a' }));
  });

  it('does not run feed id and post together ambiguously', () => {
    expect(itemId('ab', { link: 'c' })).not.toBe(itemId('a', { link: 'bc' }));
  });
});

describe('newestFirst', () => {
  it('sorts by date and keeps feed order for equal dates and for posts without one', () => {
    const items = [
      { id: 'undated-1' },
      { id: 'old', publishedAt: 1 },
      { id: 'tie-a', publishedAt: 5 },
      { id: 'undated-2' },
      { id: 'tie-b', publishedAt: 5 },
    ] as { id: string; publishedAt?: number }[];
    expect(newestFirst(items).map((i) => i.id)).toEqual(['tie-a', 'tie-b', 'old', 'undated-1', 'undated-2']);
  });
});

describe('diffItems', () => {
  it('on a first look, returns the newest posts and no more than the window', () => {
    const fresh = diffItems('f', feedOf(30), new Set());
    expect(fresh).toHaveLength(WINDOW);
    expect(fresh[0].link).toBe('https://b.example/30');
    expect(fresh.at(-1)!.link).toBe('https://b.example/11');
  });

  it('returns only posts that are not stored, newest first', () => {
    const stored = new Set(feedOf(10).slice(2).map((p) => itemId('f', p)));
    expect(diffItems('f', feedOf(10), stored).map((n) => n.title)).toEqual(['Post 10', 'Post 9']);
  });

  it('returns nothing when everything is stored', () => {
    const stored = new Set(feedOf(5).map((p) => itemId('f', p)));
    expect(diffItems('f', feedOf(5), stored)).toEqual([]);
  });

  it('does not flood after a long feed was subscribed: posts past the window are never new', () => {
    // Subscribed when the feed had 30 posts: only the newest 20 were stored.
    const stored = new Set(diffItems('f', feedOf(30), new Set()).map((n) => n.id));
    expect(diffItems('f', feedOf(30), stored)).toEqual([]);
    // One new post, and the oldest stored one slides out of the window: just the new one is new.
    expect(diffItems('f', feedOf(31), stored).map((n) => n.title)).toEqual(['Post 31']);
  });

  it('counts a post listed twice once, and carries id, feed, link, title and date', () => {
    const dup = [post(2), post(2), post(1)];
    const out = diffItems('feed-9', dup, new Set());
    expect(out).toEqual([
      { id: itemId('feed-9', post(2)), feedId: 'feed-9', link: 'https://b.example/2', title: 'Post 2', publishedAt: 2000 },
      { id: itemId('feed-9', post(1)), feedId: 'feed-9', link: 'https://b.example/1', title: 'Post 1', publishedAt: 1000 },
    ]);
  });

  it('keeps the feed’s own order for a feed with no dates', () => {
    const undated = [1, 2, 3].map((n) => post(n, { publishedAt: undefined }));
    expect(diffItems('f', undated, new Set()).map((n) => n.title)).toEqual(['Post 1', 'Post 2', 'Post 3']);
  });

  it('treats the same post in another feed as new', () => {
    const stored = new Set([itemId('f1', post(1))]);
    expect(diffItems('f2', [post(1)], stored)).toHaveLength(1);
  });
});

describe('isDue', () => {
  const now = 10 * MIN_CHECK_GAP_MS;
  it('is due when never checked, or when 30 minutes have passed', () => {
    expect(isDue({}, now)).toBe(true);
    expect(isDue({ lastCheckedAt: now - MIN_CHECK_GAP_MS }, now)).toBe(true);
    expect(isDue({ lastCheckedAt: now - MIN_CHECK_GAP_MS - 1 }, now)).toBe(true);
  });
  it('is not due sooner than that', () => {
    expect(isDue({ lastCheckedAt: now - MIN_CHECK_GAP_MS + 1 }, now)).toBe(false);
    expect(isDue({ lastCheckedAt: now }, now)).toBe(false);
  });
});

describe('idsToPrune and inboxOrder', () => {
  const stored = (feedId: string, n: number, publishedAt?: number) => ({ id: `${feedId}-${n}`, feedId, publishedAt, firstSeenAt: n });

  it('drops the oldest stored posts past the limit, per feed', () => {
    const items = [...[1, 2, 3, 4].map((n) => stored('a', n, n)), stored('b', 1, 1)];
    expect(idsToPrune(items, 2).sort()).toEqual(['a-1', 'a-2']);
    expect(idsToPrune(items, 10)).toEqual([]);
  });

  it('orders the inbox newest first, by first-seen time for posts without a date', () => {
    const items = [stored('a', 1, 500), stored('a', 2, undefined), stored('b', 3, 9)];
    expect(inboxOrder(items).map((i) => i.id)).toEqual(['a-1', 'b-3', 'a-2']);
  });
});

describe('urlKey', () => {
  it('treats the same page written differently as one', () => {
    const key = urlKey('https://www.example.com/post/')!;
    expect(urlKey('http://example.com/post')).toBe(key);
    expect(urlKey('https://EXAMPLE.com/post#comments')).toBe(key);
    expect(urlKey('https://example.com/post?utm_source=rss&utm_medium=feed')).toBe(key);
  });

  it('keeps other parameters, in a fixed order, and tells different pages apart', () => {
    expect(urlKey('https://example.com/p?b=2&a=1')).toBe(urlKey('https://example.com/p?a=1&b=2'));
    expect(urlKey('https://example.com/p?a=1')).not.toBe(urlKey('https://example.com/p?a=2'));
    expect(urlKey('https://example.com/a')).not.toBe(urlKey('https://example.com/b'));
  });

  it('is undefined for nothing or a non-address', () => {
    expect(urlKey(undefined)).toBeUndefined();
    expect(urlKey('')).toBeUndefined();
    expect(urlKey('not a url')).toBeUndefined();
  });
});
