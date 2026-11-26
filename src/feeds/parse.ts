// Feed parsing and discovery (SPEC §4 "Feed inbox"). Pure functions over strings: the caller
// does the fetching. Parsing uses the browser's DOMParser, like extraction does.

export interface ParsedItem {
  /** The feed's own id for the post. Falls back to `link` when a feed has none. */
  guid?: string;
  link: string;
  title: string;
  publishedAt?: number;
}

export interface ParsedFeed {
  title: string;
  /** The blog's home page, when the feed says where it is. */
  siteUrl?: string;
  items: ParsedItem[];
}

const children = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Titles sometimes arrive as escaped HTML or with doubled entities ("Tom &amp;amp; Jerry"); read them as text. */
function plainText(s: string): string {
  const t = squash(s);
  if (!/<[a-z/]|&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(t)) return t;
  return squash(new DOMParser().parseFromString(t, 'text/html').documentElement.textContent);
}

/** An absolute http(s) URL, or undefined. Relative links resolve against `base` (the feed's address). */
function httpUrl(href: string | null | undefined, base: string): string | undefined {
  const raw = squash(href);
  if (!raw) return undefined;
  try {
    const u = new URL(raw, base);
    return /^https?:$/.test(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function dateOf(...els: (Element | undefined)[]): number | undefined {
  for (const el of els) {
    const t = Date.parse(squash(el?.textContent));
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

/** RSS puts the address in `<link>` text; `<atom:link rel="self" href>` sits beside it and isn't the page. */
function rssLink(el: Element, base: string): string | undefined {
  for (const l of children(el, 'link')) if (!l.hasAttribute('href')) return httpUrl(l.textContent, base);
  return undefined;
}

/** Atom: the `alternate` link (or the unmarked one) is the page. */
function atomLink(el: Element, base: string): string | undefined {
  const links = children(el, 'link').filter((l) => l.hasAttribute('href'));
  const page = links.find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate');
  return httpUrl((page ?? links[0])?.getAttribute('href'), base);
}

/**
 * RSS 2.0, RSS 1.0 (RDF) or Atom, or null if the text isn't a feed (an HTML page, an error page, broken XML).
 * `baseUrl` is where the feed came from, for relative links.
 */
export function parseFeed(xml: string, baseUrl: string): ParsedFeed | null {
  let doc: Document;
  try {
    // A byte-order mark or blank line before `<?xml` is a parse error otherwise; plenty of feeds have one.
    doc = new DOMParser().parseFromString(xml.replace(/^﻿/, '').trimStart(), 'text/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;
  if (!root) return null;

  if (root.localName === 'feed') {
    const items: ParsedItem[] = [];
    for (const e of children(root, 'entry')) {
      const link = atomLink(e, baseUrl);
      if (!link) continue;
      items.push({
        guid: squash(child(e, 'id')?.textContent) || undefined,
        link,
        title: plainText(child(e, 'title')?.textContent ?? '') || link,
        publishedAt: dateOf(child(e, 'published'), child(e, 'updated')),
      });
    }
    return { title: plainText(child(root, 'title')?.textContent ?? ''), siteUrl: atomLink(root, baseUrl), items };
  }

  if (root.localName === 'rss' || root.localName === 'RDF') {
    // RSS 2.0 nests items in <channel>; RSS 1.0 puts <item> beside it under the root.
    const channel = child(root, 'channel');
    if (!channel) return null;
    const items: ParsedItem[] = [];
    for (const e of [...children(root, 'item'), ...children(channel, 'item')]) {
      const guid = child(e, 'guid');
      // A guid that is a permalink doubles as the link when an item has no <link>.
      const link = rssLink(e, baseUrl) ?? (guid?.getAttribute('isPermaLink') !== 'false' ? httpUrl(guid?.textContent, baseUrl) : undefined);
      if (!link) continue;
      items.push({
        guid: squash(guid?.textContent) || undefined,
        link,
        title: plainText(child(e, 'title')?.textContent ?? '') || link,
        publishedAt: dateOf(child(e, 'pubDate'), child(e, 'date')),
      });
    }
    return { title: plainText(child(channel, 'title')?.textContent ?? ''), siteUrl: rssLink(channel, baseUrl), items };
  }

  return null;
}

const FEED_TYPE = /^application\/(rss|atom)\+xml\b/i;

/** `<link rel="alternate" type="application/rss+xml|atom+xml">` addresses in a page, in page order. */
export function discoverFeedLinks(html: string, baseUrl: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: string[] = [];
  for (const l of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate') || !FEED_TYPE.test((l.getAttribute('type') ?? '').trim())) continue;
    const url = httpUrl(l.getAttribute('href'), baseUrl);
    if (url && !found.includes(url)) found.push(url);
  }
  return found;
}

/** Where blogs usually keep the feed, tried when a page doesn't point to one. */
export const COMMON_FEED_PATHS = ['/feed.xml', '/feed', '/rss.xml', '/atom.xml', '/index.xml'];

export function commonFeedUrls(pageUrl: string): string[] {
  try {
    const origin = new URL(pageUrl).origin;
    return COMMON_FEED_PATHS.map((p) => origin + p);
  } catch {
    return [];
  }
}

/**
 * What someone typed or pasted, as an http(s) address; undefined if it can't be one.
 * Accepts a bare "example.com/blog" and the old `feed://` scheme.
 */
export function normalizeAddress(input: string): string | undefined {
  let s = input.trim();
  if (!s || /\s/.test(s)) return undefined;
  s = s.replace(/^feed:\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
