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
    .sort((a, b) => {
      // An undated post counts as older than any dated one. Compare with < and > rather than
      // subtracting: -Infinity minus -Infinity is NaN.
      const pa = a.item.publishedAt ?? -Infinity;
      const pb = b.item.publishedAt ?? -Infinity;
      return pa === pb ? a.i - b.i : pb > pa ? 1 : -1;
    })
    .map((x) => x.item);
}

/**
 * `link` moved onto `linkBase` (an origin): the same path, query and hash on that host. Links that
 * already sit on that host, a missing `linkBase` (unset, or null for "keep links") and anything that
 * isn't an address come back unchanged. Only the stored link is rebased, never what `itemId` hashes.
 */
export function rebaseLink(link: string, linkBase: string | null | undefined): string {
  if (!linkBase) return link;
  try {
    const from = new URL(link);
    const to = new URL(linkBase);
    if (from.host === to.host) return link;
    // Set piece by piece, not `new URL(path, base)`: a path starting "//" would be read as a host.
    to.pathname = from.pathname;
    to.search = from.search;
    to.hash = from.hash;
    return to.toString();
  } catch {
    return link;
  }
}

export interface LinkProbe {
  /** The newest post's link as the feed gives it. */
  original: string;
  /** The same path and query on the feed's own host. */
  rebased: string;
  /** The feed's origin: what `linkBase` becomes if `original` is gone and `rebased` works. */
  base: string;
}

/**
 * What to try to learn whether a feed's post links still work, or undefined when there's nothing to
 * try: no posts, or the newest post's link is already on the feed's own host. A feed that is served
 * from a separate host on purpose (feedburner, say) gets probed too, but its links keep working, so
 * nothing is rebased.
 */
export function linkProbe(feedUrl: string, items: ParsedItem[]): LinkProbe | undefined {
  const newest = newestFirst(items)[0];
  if (!newest) return undefined;
  try {
    const base = new URL(feedUrl).origin;
    if (new URL(newest.link).host === new URL(base).host) return undefined;
    return { original: newest.link, rebased: rebaseLink(newest.link, base), base };
  } catch {
    return undefined;
  }
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
 * that many were kept). A post listed twice counts once. The id comes from the feed's own guid or
 * link; `linkBase` (see `rebaseLink`) changes only the stored link, so ids don't move when it is set.
 */
export function diffItems(feedId: string, fetched: ParsedItem[], storedIds: ReadonlySet<string>, window = WINDOW, linkBase?: string | null): NewItem[] {
  const seen = new Set<string>();
  const out: NewItem[] = [];
  for (const it of newestFirst(fetched).slice(0, window)) {
    const id = itemId(feedId, it);
    if (storedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, feedId, link: rebaseLink(it.link, linkBase), title: it.title, publishedAt: it.publishedAt });
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

/** How many of each feed's newest posts are marked "New" in Subscriptions. */
export const RECENT_PER_FEED = 3;

/**
 * Ids of each feed's `perFeed` newest posts, in inbox order (publish date, else first-seen time;
 * equal times keep the order given). Independent of `seenAt`, so it holds right after subscribing.
 * As newer posts are stored the set moves to them and older posts drop out.
 */
export function recentIds(items: { id: string; feedId: string; publishedAt?: number; firstSeenAt: number }[], perFeed = RECENT_PER_FEED): Set<string> {
  const byFeed = new Map<string, typeof items>();
  for (const it of items) {
    const list = byFeed.get(it.feedId);
    if (list) list.push(it);
    else byFeed.set(it.feedId, [it]);
  }
  const out = new Set<string>();
  for (const list of byFeed.values()) for (const it of inboxOrder(list).slice(0, perFeed)) out.add(it.id);
  return out;
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
