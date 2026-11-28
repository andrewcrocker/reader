import { db, getSettings, type Feed } from '../db';
import { storeFrom } from '../art/art';
import { fetchHtml } from '../pipeline/extract';

// A blog's picture for its row on Subscriptions. Fetched once through the proxy and kept in the art
// table like article art (SPEC §4a), so the list works offline. Decoration only: a blog with no
// picture shows its initials.

/** Smaller than this and it is a browser-tab favicon, which looks soft at row size. */
const MIN_SIDE = 48;

export const feedArtKey = (feedId: string) => `feed:${feedId}`;

/** The blog's home page: where its posts are read (a blog that moved keeps its icon there), else its site, else the feed's own host. */
export function feedHome(feed: Pick<Feed, 'feedUrl' | 'siteUrl' | 'linkBase'>): string | undefined {
  for (const base of [feed.linkBase, feed.siteUrl, feed.feedUrl]) {
    if (!base) continue;
    try {
      return new URL(base).origin + '/';
    } catch {
      /* not an address: try the next */
    }
  }
  return undefined;
}

/**
 * The icons a page offers, largest first: its home-screen icons (`apple-touch-icon`), then any
 * `rel="icon"` that says it is at least 48 wide. A plain favicon with no size is left out; it is
 * tried last, by its usual address.
 */
export function pageIcons(html: string, base: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: { url: string; size: number }[] = [];
  for (const l of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!touch && !rel.includes('icon')) continue;
    const size = Number(l.getAttribute('sizes')?.split(/x/i)[0]) || (touch ? 180 : 0);
    if (size < MIN_SIDE) continue;
    try {
      const u = new URL(l.getAttribute('href')!, base);
      if (/^https?:$/.test(u.protocol) && !found.some((f) => f.url === u.toString())) found.push({ url: u.toString(), size });
    } catch {
      /* not an address */
    }
  }
  return found.sort((a, b) => b.size - a.size).map((f) => f.url);
}

/**
 * Where a blog's picture might be, best first: the icons its home page offers, the feed's own image
 * (often a 32 px favicon, which is too small and gets skipped), then the two usual addresses.
 */
export function feedArtCandidates(home: string | undefined, icons: string[], feedImage?: string): string[] {
  const out = [...icons];
  if (feedImage) out.push(feedImage);
  if (home) out.push(new URL('/apple-touch-icon.png', home).toString(), new URL('/favicon.ico', home).toString());
  return [...new Set(out)];
}

/**
 * Finds and stores the blog's picture, then records the result on the feed: its art key, or '' for
 * "looked, none found" so it isn't tried again on every check (Refresh on the blog's row does try again). Never throws.
 */
export async function fetchFeedArt(feed: Feed, feedImage?: string): Promise<void> {
  const key = feedArtKey(feed.id);
  let found = false;
  try {
    const home = feedHome(feed);
    // The home page says where its icons are. If it can't be read, the usual addresses are still tried.
    // `null`: the page couldn't be read just now, so we don't know what it offers.
    const offered = home ? await fetchHtml(home, await getSettings()).then((r) => (r.html ? pageIcons(r.html, r.finalUrl) : []), () => null) : [];
    const icons = offered ?? [];
    for (const url of feedArtCandidates(home, icons, feedImage)) {
      if ((await storeFrom(url, key, true, MIN_SIDE)) !== undefined) {
        found = true;
        break;
      }
    }
    // Removed while we were looking: don't leave its picture behind.
    if (!(await db.feeds.get(feed.id))) return void (await db.art.delete(key));
    // Nothing found and the home page didn't answer: that may pass (the service was down, a timeout), so leave it
    // unset and the next check looks again. '' is only for a blog whose page we read and that had nothing usable.
    if (!found && offered === null) return;
    await db.feeds.update(feed.id, { artKey: found ? key : '' });
  } catch (err) {
    console.warn('feed art failed', err);
  }
}
