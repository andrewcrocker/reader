import { db, getSettings, type Feed, type FeedItem, type Settings } from '../db';
import { ExtractError, fetchHtml } from '../pipeline/extract';
import { addUrl } from '../pipeline/runner';
import { discoverFeed, FeedError, probeLinkBase, type FetchText } from './discover';
import { diffItems, idsToPrune, isDue, rebaseLink, urlKey, WINDOW } from './diff';
import { fetchFeedArt, feedArtKey } from './art';
import { parseFeed } from './parse';
import { singleFlight } from './singleFlight';

// Subscriptions on the device (SPEC §4 "Feed inbox"). Pull only: feeds are read when the app
// opens, when it comes back to the front, and when asked. Nothing is added to the queue by itself.

const fetcher =
  (settings: Settings): FetchText =>
  async (url) => {
    const r = await fetchHtml(url, settings);
    // A PDF comes back as bytes, not text: it isn't a feed and links to nothing, but its site did answer.
    return { text: r.html ?? '', finalUrl: r.finalUrl };
  };

/** Like `fetcher`, for asking whether a link's site answers: it did if our service only declined the page (too large, not HTML). */
const probeFetcher =
  (settings: Settings): FetchText =>
  async (url) => {
    try {
      return await fetcher(settings)(url);
    } catch (e) {
      if (e instanceof ExtractError && e.reached) return { text: '', finalUrl: url };
      throw e;
    }
  };

/** One line for the user: our own errors say what's wrong; anything else gets a general line. */
const reason = (e: unknown) => (e instanceof FeedError || e instanceof ExtractError ? e.message : 'Couldn’t read the feed.');

/** Subscribes to what a person pasted (a site or a feed address). The posts already there are kept as seen. */
export async function subscribe(input: string): Promise<Feed> {
  const settings = await getSettings();
  const { feedUrl, feed: parsed } = await discoverFeed(input, fetcher(settings));
  if (await db.feeds.where('feedUrl').equals(feedUrl).first()) throw new FeedError('You’re already subscribed to that.');

  // Whether the post links still work, or should move onto the feed's host (see `probeLinkBase`).
  const linkBase = await probeLinkBase(feedUrl, parsed.items, probeFetcher(settings));
  const now = Date.now();
  const feed: Feed = {
    id: crypto.randomUUID(),
    feedUrl,
    siteUrl: parsed.siteUrl,
    title: parsed.title || new URL(feedUrl).hostname.replace(/^www\./, ''),
    addedAt: now,
    lastCheckedAt: now,
    linkBase,
  };
  // The latest posts are kept, already seen, so subscribing doesn't light the dot.
  const items: FeedItem[] = diffItems(feed.id, parsed.items, new Set(), WINDOW, linkBase).map((n) => ({ ...n, firstSeenAt: now, seenAt: now }));
  await db.transaction('rw', db.feeds, db.feedItems, async () => {
    await db.feeds.add(feed);
    await db.feedItems.bulkAdd(items);
  });
  // The blog's picture arrives on its own; the row shows initials until then.
  void fetchFeedArt(feed, parsed.imageUrl);
  return feed;
}

export interface CheckResult {
  checked: number;
  added: number;
  failed: number;
}

const NONE: CheckResult = { checked: 0, added: 0, failed: 0 };

// A check already under way covers a later one (launch and "back in front" can land together). The
// exception is `force`: a check that skipped recently checked feeds can't stand in for Refresh,
// so a forced call waits for it to finish and then checks every feed (see `singleFlight`).
const flight = singleFlight((force: boolean) => run(force).catch(() => NONE));

/**
 * Looks for new posts. Feeds checked in the last 30 minutes are skipped unless `force`. Only posts
 * not stored yet are added, unseen. A feed that fails just records why, per feed, with no banner.
 */
export function checkFeeds({ force = false }: { force?: boolean } = {}): Promise<CheckResult> {
  return flight(force);
}

async function run(force: boolean): Promise<CheckResult> {
  // Offline or not set up isn't the feed's fault, so nothing is recorded.
  if (!navigator.onLine) return NONE;
  const settings = await getSettings();
  if (!settings.proxySecret || settings.inviteRejected) return NONE;

  const now = Date.now();
  const due = (await db.feeds.toArray()).filter((f) => force || isDue(f, now));
  const results = await Promise.all(due.map((f) => checkOne(f, settings)));
  return results.reduce((sum, r) => ({ checked: sum.checked + 1, added: sum.added + (r ?? 0), failed: sum.failed + (r === null ? 1 : 0) }), NONE);
}

/** How many posts were added, or null if the feed couldn't be read. */
async function checkOne(feed: Feed, settings: Settings): Promise<number | null> {
  try {
    const page = await fetcher(settings)(feed.feedUrl);
    const parsed = parseFeed(page.text, page.finalUrl);
    if (!parsed) throw new FeedError('That address no longer gives a feed.');
    // Feeds saved before `linkBase` existed (and feeds with no posts when they were checked) are looked at once, here.
    const linkBase = feed.linkBase !== undefined ? feed.linkBase : await probeLinkBase(feed.feedUrl, parsed.items, probeFetcher(settings));
    // Looked for once (and again after an undo, which clears it). Not awaited: a picture never holds up a check.
    if (feed.artKey === undefined) void fetchFeedArt({ ...feed, linkBase }, parsed.imageUrl);
    return await db.transaction('rw', db.feeds, db.feedItems, async () => {
      // Removed while the request was out: don't bring its posts back.
      if (!(await db.feeds.get(feed.id))) return 0;
      const stored = await db.feedItems.where('feedId').equals(feed.id).toArray();
      const now = Date.now();
      const fresh: FeedItem[] = diffItems(feed.id, parsed.items, new Set(stored.map((i) => i.id)), WINDOW, linkBase).map((n) => ({ ...n, firstSeenAt: now, seenAt: null }));
      await db.feedItems.bulkAdd(fresh);
      await db.feedItems.bulkDelete(idsToPrune([...stored, ...fresh]));
      await db.feeds.update(feed.id, { lastCheckedAt: now, lastError: undefined, title: parsed.title || feed.title, siteUrl: parsed.siteUrl ?? feed.siteUrl, linkBase });
      return fresh.length;
    });
  } catch (e) {
    await db.feeds.update(feed.id, { lastCheckedAt: Date.now(), lastError: reason(e) });
    return null;
  }
}

let started = false;

/** Checks now, then again each time the app comes back to the front. */
export function startFeedChecks(): void {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkFeeds();
  });
  void checkFeeds();
}

/**
 * Checks one blog now, whenever it was last checked (Refresh on its row). Offline or not set up
 * does nothing and records nothing, like `checkFeeds`. Returns how many posts were added, or null
 * if the blog couldn't be read.
 */
export async function refreshFeed(feedId: string): Promise<number | null> {
  if (!navigator.onLine) return null;
  const settings = await getSettings();
  if (!settings.proxySecret || settings.inviteRejected) return null;
  const feed = await db.feeds.get(feedId);
  return feed ? checkOne(feed, settings) : null;
}

/** Marks one blog's posts as seen: its dots and its count clear, and the tab's dot goes when no blog has any left. */
export async function markFeedSeen(feedId: string): Promise<void> {
  const now = Date.now();
  await db.feedItems.where('feedId').equals(feedId).filter((i) => i.seenAt === null).modify({ seenAt: now });
}

/**
 * Adds a post to the queue. A post that is already an article (by address) isn't added twice.
 * `existed` says which happened. The address is the feed's `linkBase` applied, also for posts
 * stored before it was worked out, both to fetch and to compare with what's already queued.
 */
export async function addFeedItem(item: FeedItem): Promise<{ articleId: string; existed: boolean }> {
  const fresh = await db.feedItems.get(item.id);
  // Already an article, unless that article has since been deleted: then the post can be added again.
  const made = fresh?.articleId ? await db.articles.get(fresh.articleId) : undefined;
  if (made && !made.deletedAt) return { articleId: made.id, existed: true };
  const link = rebaseLink(item.link, (await db.feeds.get(item.feedId))?.linkBase);
  const key = urlKey(link);
  const match = key ? await db.articles.filter((a) => !a.deletedAt && (urlKey(a.url) === key || urlKey(a.canonicalUrl) === key)).first() : undefined;
  const articleId = match?.id ?? (await addUrl(link, item.title));
  await db.feedItems.update(item.id, { articleId });
  return { articleId, existed: !!match };
}

/** Removes a subscription and its posts. Articles already added stay. Returns the undo. */
export async function removeFeed(feed: Feed): Promise<() => Promise<void>> {
  const items = await db.feedItems.where('feedId').equals(feed.id).toArray();
  await db.transaction('rw', db.feeds, db.feedItems, db.art, async () => {
    await db.feedItems.where('feedId').equals(feed.id).delete();
    await db.feeds.delete(feed.id);
    await db.art.delete(feedArtKey(feed.id));
  });
  return async () => {
    await db.transaction('rw', db.feeds, db.feedItems, async () => {
      // Its picture went with it, so it's looked for again on the next check.
      await db.feeds.put({ ...feed, artKey: undefined });
      await db.feedItems.bulkPut(items);
    });
  };
}
