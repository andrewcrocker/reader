import type { Article } from '../db';
import { hasRealTitle, lengthSec, urlTitle } from '../queue/display';
import { domainColor } from '../theme/color';

// Sharing from Saved (SPEC §4 "Sharing a reading list"): which loved articles go in a list, what it's
// called, and what the card draws. The list itself is the maintainer's `#list=` link (src/app/share.ts).
// Pure functions, so the rules are testable without a browser.

export type ShareRange = 'week' | 'all';

/**
 * Midnight at the start of the calendar week that contains `now`: Monday 00:00 in the device's local
 * time. Built with calendar arithmetic (`setDate`), not by subtracting 24-hour days, so the week that
 * holds a daylight-saving change still starts at local midnight.
 */
export function weekStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Midnight at the start of the next week (Monday 00:00 local): the first moment that is no longer "this week". */
export function nextWeekStart(now = Date.now()): number {
  const d = new Date(weekStart(now));
  d.setDate(d.getDate() + 7);
  return d.getTime();
}
/** The most a sender's name can say. */
export const MAX_NAME = 40;

export const RANGE_LABEL: Record<ShareRange, string> = { week: 'This week', all: 'All time' };

/** A loved article with a link other people can open. (Pasted text has none, so it can't be in a shared list.) */
export const isShareable = (a: Article) => !a.deletedAt && !!a.lovedAt && a.source === 'url' && /^https?:\/\//i.test(a.url);

/** Loved articles, newest love first, whether or not they're archived. Pasted text counts here: it's loved, just not shareable. */
export function lovedArticles(articles: Article[]): Article[] {
  return articles.filter((a) => !a.deletedAt && a.lovedAt).sort((a, b) => b.lovedAt! - a.lovedAt!);
}

/**
 * What a list of this range would hold: shareable loved articles, newest love first. "This week" is the
 * calendar week, Monday 00:00 through Sunday 23:59 local time, by when you loved them: it counts up
 * through the week and starts again from zero on Monday.
 */
export function listArticles(articles: Article[], range: ShareRange, now = Date.now()): Article[] {
  const since = range === 'week' ? weekStart(now) : 0;
  const until = range === 'week' ? nextWeekStart(now) : Infinity;
  return lovedArticles(articles).filter((a) => isShareable(a) && a.lovedAt! >= since && a.lovedAt! < until);
}

export function rangeCounts(articles: Article[], now = Date.now()): Record<ShareRange, number> {
  return { week: listArticles(articles, 'week', now).length, all: listArticles(articles, 'all', now).length };
}

/** "Zach’s", "James’". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** The list's name (and the card's headline): "Zach’s reading this week", "Zach’s all-time favorites", or neutral wording with no name. */
export function headline(name: string | undefined, range: ShareRange): string {
  const who = name?.trim();
  if (range === 'week') return who ? `${possessive(who)} reading this week` : 'Worth reading this week';
  return who ? `${possessive(who)} all-time favorites` : 'All-time favorites';
}

/** One article as the card shows it. */
export interface ShareItem {
  title: string;
  url: string;
  domain: string;
  byline?: string;
  minutes?: number;
  tint?: string;
}

export function toShareItem(a: Article): ShareItem {
  const sec = lengthSec(a);
  const domain = a.domain || new URL(a.url).hostname.replace(/^www\./, '');
  const item: ShareItem = { title: hasRealTitle(a) ? a.title : urlTitle(a.url), url: a.url, domain, tint: (a.tintSource ?? domainColor(domain)).toLowerCase() };
  if (a.byline) item.byline = a.byline;
  if (sec) item.minutes = Math.max(1, Math.round(sec / 60));
  return item;
}

/**
 * A string that changes whenever anything the card draws, or the link carries, for these articles changes:
 * their order, title, link, site, tint, listening time or art. Not just which articles they are, since
 * extraction finishing replaces a URL title, the tint comes from the extraction and art arrives later.
 * Playback position and the like are left out, so a playing article doesn't redraw the card.
 */
export function listSignature(list: Article[]): string {
  return list
    .map((a) => {
      const it = toShareItem(a);
      return [a.id, a.title, it.title, a.url, a.siteName ?? '', it.domain, it.tint, it.minutes ?? '', a.siteArtKey ?? '', a.articleArtKey ?? ''].join('\u001f');
    })
    .join('\u001e');
}

/** The file name for the saved or attached card: "Zach’s reading this week" -> "zachs-reading-this-week.png". */
export function cardFileName(headline: string): string {
  const slug = headline
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'reader-list'}.png`;
}
