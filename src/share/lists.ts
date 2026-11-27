import type { Article } from '../db';
import { lengthSec } from '../queue/display';
import { domainColor } from '../theme/color';

// Shareable reading lists (spec/SHARING.md): which loved articles go in a list, what it's called,
// and the JSON the Worker stores. Pure functions, so the rules are testable without a browser.

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
/** The Worker's cap on a list (worker/src/lists.ts). */
export const MAX_ITEMS = 50;
export const MAX_NAME = 40;
export const MAX_NOTE = 140;

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

/** The card and page headline: "Zach’s reading this week", "Zach’s all-time favorites", or neutral wording with no name. */
export function headline(name: string | undefined, range: ShareRange): string {
  const who = name?.trim();
  if (range === 'week') return who ? `${possessive(who)} reading this week` : 'Worth reading this week';
  return who ? `${possessive(who)} all-time favorites` : 'All-time favorites';
}

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One item of a published list: what the public page and the card show. */
export interface ShareItem {
  title: string;
  url: string;
  domain: string;
  byline?: string;
  minutes?: number;
  tint?: string;
}

/** The title to show for an article (the URL's host and path while the real title hasn't arrived). */
export function displayTitle(a: Article): string {
  if (a.title && a.title !== a.url) return a.title;
  try {
    const u = new URL(a.url);
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return a.url;
  }
}

export function toShareItem(a: Article): ShareItem {
  const sec = lengthSec(a);
  const domain = a.domain || new URL(a.url).hostname.replace(/^www\./, '');
  const item: ShareItem = { title: displayTitle(a), url: a.url, domain, tint: (a.tintSource ?? domainColor(domain)).toLowerCase() };
  if (a.byline) item.byline = a.byline;
  if (sec) item.minutes = Math.max(1, Math.round(sec / 60));
  return item;
}

export interface PublishRequest {
  title: string;
  note?: string;
  name?: string;
  range: ShareRange;
  items: ShareItem[];
}

/** The JSON half of `POST /lists`. */
export function publishRequest(articles: Article[], range: ShareRange, name: string, note: string, now = Date.now()): PublishRequest {
  const who = name.trim().slice(0, MAX_NAME);
  const body: PublishRequest = {
    title: headline(who, range),
    range,
    items: listArticles(articles, range, now).slice(0, MAX_ITEMS).map(toShareItem),
  };
  if (who) body.name = who;
  const n = note.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE);
  if (n) body.note = n;
  return body;
}
