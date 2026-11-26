import { linkProbe } from './diff';
import { commonFeedUrls, discoverFeedLinks, normalizeAddress, parseFeed, type ParsedFeed, type ParsedItem } from './parse';

/** A problem with a feed that has a plain one-line reason to show. */
export class FeedError extends Error {}

export interface Fetched {
  text: string;
  /** Where the request ended up after redirects. */
  finalUrl: string;
}

/** Gets a page or feed through the proxy. Throws if it can't. */
export type FetchText = (url: string) => Promise<Fetched>;

export interface Discovered {
  feedUrl: string;
  feed: ParsedFeed;
}

/** How many `<link rel="alternate">` feeds to try from a page, before the common paths. */
const MAX_LINKED = 3;

/**
 * Finds the feed for something a person pasted (SPEC §4): the address itself if it is a feed;
 * else the feeds the page links to; else the common paths on the same site. A failure fetching
 * the pasted address is passed on (it says why); failures on the guesses just move on.
 */
export async function discoverFeed(input: string, fetchText: FetchText): Promise<Discovered> {
  const address = normalizeAddress(input);
  if (!address) throw new FeedError('That doesn’t look like a web address.');

  const page = await fetchText(address);
  const direct = parseFeed(page.text, page.finalUrl);
  if (direct) return { feedUrl: page.finalUrl, feed: direct };

  const tried = new Set([page.finalUrl]);
  const guesses = [...discoverFeedLinks(page.text, page.finalUrl).slice(0, MAX_LINKED), ...commonFeedUrls(page.finalUrl)];
  for (const url of guesses) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const r = await fetchText(url);
      const feed = parseFeed(r.text, r.finalUrl);
      if (feed) return { feedUrl: r.finalUrl, feed };
    } catch {
      /* not there: try the next one */
    }
  }
  throw new FeedError('Couldn’t find a feed at that address.');
}

/**
 * Whether a feed's post links should be moved onto the feed's own host (stored as `Feed.linkBase`):
 * a blog that moved hosts but still serves its feed from the new one (Vitalik's feed is on
 * vitalik.eth.limo and links to vitalik.ca, which no longer resolves). Asks about the newest post only:
 * - its link is on the feed's host, or the original answers: `null`, keep the links;
 * - the original fails (any error) and the same path and query on the feed's host answers: that
 *   host's origin, so links move there;
 * - both fail: `null` too (the feed's own host just answered, so it isn't the network);
 * - the feed has no posts to judge by: `undefined`, look again next time.
 * `fetchText` should resolve whenever the site answered, even if the page itself can't be used.
 */
export async function probeLinkBase(feedUrl: string, items: ParsedItem[], fetchText: FetchText): Promise<string | null | undefined> {
  if (!items.length) return undefined;
  const probe = linkProbe(feedUrl, items);
  if (!probe) return null;
  const answers = (url: string) => fetchText(url).then(() => true, () => false);
  if (await answers(probe.original)) return null;
  return (await answers(probe.rebased)) ? probe.base : null;
}
