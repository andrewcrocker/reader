// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { diffItems, idsToPrune, inboxOrder, isDue, itemId, linkProbe, MIN_CHECK_GAP_MS, newestFirst, rebaseLink, recentIds, urlKey, WINDOW } from './diff';
import { ATOM_FEED, VITALIK_FEED } from './fixtures';
import { parseFeed, type ParsedItem } from './parse';

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

  it('keeps feed order when no post has a date', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as { id: string; publishedAt?: number }[];
    expect(newestFirst(items).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts an undated post after a dated one wherever it sits in the feed', () => {
    const items = [{ id: 'undated' }, { id: 'dated', publishedAt: 0 }] as { id: string; publishedAt?: number }[];
    expect(newestFirst(items).map((i) => i.id)).toEqual(['dated', 'undated']);
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

describe('recentIds', () => {
  const stored = (feedId: string, n: number, publishedAt?: number, firstSeenAt = n) => ({ id: `${feedId}-${n}`, feedId, publishedAt, firstSeenAt });
  const ids = (set: Set<string>) => [...set].sort();

  it('takes the three newest of each feed', () => {
    const items = [
      ...[1, 2, 3, 4, 5].map((n) => stored('a', n, n)),
      ...[1, 2, 3, 4].map((n) => stored('b', n, n * 10)),
    ];
    expect(ids(recentIds(items))).toEqual(['a-3', 'a-4', 'a-5', 'b-2', 'b-3', 'b-4']);
  });

  it('does not depend on the order the items come in', () => {
    const items = [1, 2, 3, 4, 5].map((n) => stored('a', n, n));
    expect(ids(recentIds([...items].reverse()))).toEqual(ids(recentIds(items)));
  });

  it('marks every post of a feed with fewer than three, and nothing for no items', () => {
    expect(ids(recentIds([stored('a', 1, 1), stored('a', 2, 2), stored('b', 1, 1)]))).toEqual(['a-1', 'a-2', 'b-1']);
    expect(recentIds([]).size).toBe(0);
  });

  it('ranks a post with no publish date by when it was first seen', () => {
    const items = [
      stored('a', 1, 100),
      stored('a', 2, 200),
      stored('a', 3, 300),
      stored('a', 4, undefined, 250), // between 200 and 300
    ];
    expect(ids(recentIds(items))).toEqual(['a-2', 'a-3', 'a-4']);
    // Seen long ago, it is the oldest and drops out.
    expect(ids(recentIds([...items.slice(0, 3), stored('a', 4, undefined, 50)]))).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('keeps the order given for equal times, so the same three every time', () => {
    const items = [1, 2, 3, 4, 5].map((n) => stored('a', n, 500));
    expect(ids(recentIds(items))).toEqual(['a-1', 'a-2', 'a-3']);
    expect(ids(recentIds(items))).toEqual(ids(recentIds(items)));
    // Undated posts seen at the same moment tie the same way.
    const undated = [1, 2, 3, 4].map((n) => stored('a', n, undefined, 7));
    expect(ids(recentIds(undated))).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('moves to newer posts as they arrive, and takes a different count', () => {
    const before = [1, 2, 3].map((n) => stored('a', n, n));
    expect(ids(recentIds(before))).toEqual(['a-1', 'a-2', 'a-3']);
    const after = [...before, stored('a', 4, 4)];
    expect(ids(recentIds(after))).toEqual(['a-2', 'a-3', 'a-4']);
    expect(ids(recentIds(after, 1))).toEqual(['a-4']);
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

const VITALIK_URL = 'https://vitalik.eth.limo/feed.xml';
const VITALIK_BASE = 'https://vitalik.eth.limo';
const vitalik = () => parseFeed(VITALIK_FEED, VITALIK_URL)!.items;

describe('rebaseLink', () => {
  it('moves a post onto the feed’s host, keeping its path, query and hash', () => {
    expect(rebaseLink('https://vitalik.ca/general/2026/10/31/digital_minimalism.html', VITALIK_BASE)).toBe('https://vitalik.eth.limo/general/2026/10/31/digital_minimalism.html');
    expect(rebaseLink('http://old.example/a/b/?page=2&x=y#notes', 'https://new.example')).toBe('https://new.example/a/b/?page=2&x=y#notes');
    expect(rebaseLink('https://old.example', 'https://new.example')).toBe('https://new.example/');
  });

  it('takes the port and scheme from the base', () => {
    expect(rebaseLink('https://old.example/p', 'http://localhost:8080')).toBe('http://localhost:8080/p');
  });

  it('leaves a link already on that host alone, as written', () => {
    expect(rebaseLink('https://vitalik.eth.limo/general/x.html', VITALIK_BASE)).toBe('https://vitalik.eth.limo/general/x.html');
    expect(rebaseLink('http://new.example/Path?Q=1', 'https://new.example')).toBe('http://new.example/Path?Q=1');
  });

  it('does nothing without a base: unset, or null for "checked, keep links"', () => {
    const link = 'https://vitalik.ca/general/x.html';
    expect(rebaseLink(link, undefined)).toBe(link);
    expect(rebaseLink(link, null)).toBe(link);
    expect(rebaseLink(link, '')).toBe(link);
  });

  it('is stable when applied twice', () => {
    const once = rebaseLink('https://vitalik.ca/general/x.html?a=1#h', VITALIK_BASE);
    expect(rebaseLink(once, VITALIK_BASE)).toBe(once);
  });

  it('never reads a path starting with // as a host', () => {
    expect(rebaseLink('https://old.example//evil.example/x', 'https://new.example')).toBe('https://new.example//evil.example/x');
  });

  it('returns what it was given when either side is not an address', () => {
    expect(rebaseLink('not a url', VITALIK_BASE)).toBe('not a url');
    expect(rebaseLink('https://vitalik.ca/x', 'not a url')).toBe('https://vitalik.ca/x');
  });
});

describe('linkProbe', () => {
  it('for Vitalik’s feed, asks about the newest post and what it becomes on the feed’s host', () => {
    expect(linkProbe(VITALIK_URL, vitalik())).toEqual({
      original: 'https://vitalik.ca/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html',
      rebased: 'https://vitalik.eth.limo/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html',
      base: VITALIK_BASE,
    });
  });

  it('judges by the newest post, not the first listed', () => {
    const items = [...vitalik()].reverse();
    expect(linkProbe(VITALIK_URL, items)?.original).toContain('/2026/11/26/');
    const mixed: ParsedItem[] = [
      { link: 'https://elsewhere.example/old', title: 'Old', publishedAt: 1 },
      { link: 'https://blog.example/new', title: 'New', publishedAt: 2 },
    ];
    expect(linkProbe('https://blog.example/feed', mixed)).toBeUndefined();
  });

  it('has nothing to ask when the newest post is already on the feed’s host', () => {
    expect(linkProbe('https://notes.example.com/atom.xml', parseFeed(ATOM_FEED, 'https://notes.example.com/atom.xml')!.items)).toBeUndefined();
  });

  it('has nothing to ask for a feed with no posts, or an address that isn’t one', () => {
    expect(linkProbe(VITALIK_URL, [])).toBeUndefined();
    expect(linkProbe('not a url', vitalik())).toBeUndefined();
  });

  it('keeps the query in the rebased address, and a feed on its own host still gets probed', () => {
    const items: ParsedItem[] = [{ link: 'https://blog.example/post?id=7', title: 'P', publishedAt: 1 }];
    expect(linkProbe('https://feeds.feedburner.com/example', items)).toEqual({
      original: 'https://blog.example/post?id=7',
      rebased: 'https://feeds.feedburner.com/post?id=7',
      base: 'https://feeds.feedburner.com',
    });
  });
});

describe('diffItems with a linkBase', () => {
  it('stores rebased links but keeps every id as it was, so nothing stored looks new', () => {
    const plain = diffItems('f', vitalik(), new Set());
    const rebased = diffItems('f', vitalik(), new Set(), WINDOW, VITALIK_BASE);
    expect(rebased.map((n) => n.id)).toEqual(plain.map((n) => n.id));
    expect(rebased.map((n) => n.id)).toEqual(vitalik().map((it) => itemId('f', it)));
    expect(plain.every((n) => n.link.startsWith('https://vitalik.ca/'))).toBe(true);
    expect(rebased.every((n) => n.link.startsWith('https://vitalik.eth.limo/general/'))).toBe(true);
    // Posts stored before the base was known, checked again after: still nothing new.
    expect(diffItems('f', vitalik(), new Set(plain.map((n) => n.id)), WINDOW, VITALIK_BASE)).toEqual([]);
  });

  it('keeps the links when the base is null or unset', () => {
    const plain = diffItems('f', vitalik(), new Set());
    expect(diffItems('f', vitalik(), new Set(), WINDOW, null)).toEqual(plain);
    expect(diffItems('f', vitalik(), new Set(), WINDOW, undefined)).toEqual(plain);
  });

  it('a rebased link is the same queue entry as the same post added from the feed’s host', () => {
    const [newest] = diffItems('f', vitalik(), new Set(), WINDOW, VITALIK_BASE);
    const original = vitalik()[0].link;
    expect(urlKey(newest.link)).toBe(urlKey('https://www.vitalik.eth.limo/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html#top'));
    expect(urlKey(newest.link)).not.toBe(urlKey(original));
    expect(urlKey(rebaseLink(original, VITALIK_BASE))).toBe(urlKey(newest.link));
  });
});
