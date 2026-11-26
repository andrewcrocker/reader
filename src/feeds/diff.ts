import type { ParsedItem } from './parse';

// Which fetched feed items are new, and the small rules around them. Pure, so it's testable
// without IndexedDB. The checker in store.ts applies these to what's stored.

/** Only a feed's newest posts are ever considered. Older ones can't show up as "new" later. */
export const WINDOW = 20;
/** Stored items kept per feed. More than WINDOW, so anything still in the window is never forgotten. */
export const KEEP_PER_FEED = 40;
/** A feed checked more recently than this is skipped (SPEC §4). */
export const MIN_CHECK_GAP_MS = 30 * 60 * 1000;

/** A small stable string hash (cyrb53). Not for security: it only needs to be the same every time. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The same post in the same feed always gets the same id: a hash of the feed id and the post's guid (or its link). */
export function itemId(feedId: string, item: Pick<ParsedItem, 'guid' | 'link'>): string {
  return hash(`${feedId}\n${item.guid?.trim() || item.link}`);
}

/** Newest first. Posts without a date keep the feed's own order and sort after dated ones. */
export function newestFirst<T extends { publishedAt?: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.publishedAt ?? -Infinity) - (a.item.publishedAt ?? -Infinity) || a.i - b.i)
    .map((x) => x.item);
}

export interface NewItem {
  id: string;
  feedId: string;
  link: string;
  title: string;
  publishedAt?: number;
}

/**
 * The items in `fetched` that aren't stored yet, newest first. Looks only at the newest `window`
 * posts, so a long feed doesn't flood the inbox on the first check after subscribing (when only
 * that many were kept). A post listed twice counts once.
 */
export function diffItems(feedId: string, fetched: ParsedItem[], storedIds: ReadonlySet<string>, window = WINDOW): NewItem[] {
  const seen = new Set<string>();
  const out: NewItem[] = [];
  for (const it of newestFirst(fetched).slice(0, window)) {
    const id = itemId(feedId, it);
    if (storedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, feedId, link: it.link, title: it.title, publishedAt: it.publishedAt });
  }
  return out;
}

/** True when a feed is due for a check: never checked, or last checked at least `gap` ago. */
export function isDue(feed: { lastCheckedAt?: number }, now: number, gap = MIN_CHECK_GAP_MS): boolean {
  return feed.lastCheckedAt === undefined || now - feed.lastCheckedAt >= gap;
}

/** Ids of stored items past the newest `keep` in their feed. */
export function idsToPrune(items: { id: string; feedId: string; publishedAt?: number; firstSeenAt: number }[], keep = KEEP_PER_FEED): string[] {
  const byFeed = new Map<string, typeof items>();
  for (const it of items) byFeed.set(it.feedId, [...(byFeed.get(it.feedId) ?? []), it]);
  return [...byFeed.values()].flatMap((list) => inboxOrder(list).slice(keep).map((it) => it.id));
}

/** Inbox order: newest first, by publish date, or by when we first saw the post if it has none. */
export function inboxOrder<T extends { publishedAt?: number; firstSeenAt: number }>(items: T[]): T[] {
  const when = (it: T) => it.publishedAt ?? it.firstSeenAt;
  return [...items].sort((a, b) => when(b) - when(a));
}

/**
 * Two addresses for the same page: ignores the scheme, "www.", a trailing slash, the #fragment
 * and utm_ tracking parameters. Used to spot a post that's already an article.
 */
export function urlKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const query = [...u.searchParams]
      .filter(([k]) => !/^utm_/i.test(k))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('&');
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}`;
  } catch {
    return undefined;
  }
}
