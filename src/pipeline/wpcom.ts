import { parseHtml } from './dom';

// WordPress.com turns away our fetch service (it answers data-center traffic with a 403 browser
// check), on every blog it hosts and on its own API. That API is open to any web page, though, so
// the device asks it directly. Used only after the site has blocked the normal fetch (SPEC §5).
// The service worker imports this: no DOM-only APIs.

const API = 'https://public-api.wordpress.com/rest/v1.1/sites';
const TIMEOUT_MS = 15_000;
/** As many posts as a feed check ever looks at. */
const POSTS = 20;

export interface WpcomPost {
  guid?: string;
  link: string;
  title: string;
  publishedAt?: number;
}

export interface WpcomSite {
  title: string;
  siteUrl?: string;
  imageUrl?: string;
}

export interface WpcomArticle extends WpcomPost {
  /** The post's body as the blog wrote it. */
  contentHtml: string;
  byline?: string;
  imageUrl?: string;
}

interface RawPost {
  guid?: unknown;
  URL?: unknown;
  title?: unknown;
  date?: unknown;
  content?: unknown;
  author?: { name?: unknown };
  featured_image?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function httpUrl(v: unknown): string | undefined {
  try {
    const u = new URL(str(v) ?? '');
    return /^https?:$/.test(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The API sends titles and names as HTML ("On the &#8216;Sullan Republic&#8217;"); read them as text. */
function plainText(v: unknown): string {
  const s = str(v) ?? '';
  if (!/[<&]/.test(s)) return s;
  return (parseHtml(`<!doctype html><body>${s}</body>`).body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The address's host, as the API names a site. Undefined if it isn't a web address. */
function siteOf(address: string): string | undefined {
  try {
    const u = new URL(address);
    return /^https?:$/.test(u.protocol) ? u.hostname : undefined;
  } catch {
    return undefined;
  }
}

/** JSON from the API, or null for anything else: not a WordPress.com site, a missing post, offline. */
async function ask(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function toPost(raw: RawPost): WpcomPost | undefined {
  const link = httpUrl(raw.URL);
  if (!link) return undefined;
  const at = Date.parse(str(raw.date) ?? '');
  return { guid: str(raw.guid), link, title: plainText(raw.title) || link, publishedAt: Number.isFinite(at) ? at : undefined };
}

async function site(host: string): Promise<WpcomSite | null> {
  const raw = (await ask(`${encodeURIComponent(host)}?fields=name,URL,icon`)) as { name?: unknown; URL?: unknown; icon?: { img?: unknown } } | null;
  if (!raw) return null;
  return { title: plainText(raw.name), siteUrl: httpUrl(raw.URL), imageUrl: httpUrl(raw.icon?.img) };
}

/** The feed address every WordPress blog has. Stored for a blog we could only read through the API. */
export function wpcomFeedUrl(address: string): string | undefined {
  const host = siteOf(address);
  return host && `https://${host}/feed/`;
}

/** The blog at this address and its newest posts, or null if WordPress.com doesn't host it. */
export async function wpcomFeed(address: string): Promise<(WpcomSite & { items: WpcomPost[] }) | null> {
  const host = siteOf(address);
  if (!host) return null;
  const [about, list] = await Promise.all([
    site(host),
    ask(`${encodeURIComponent(host)}/posts?number=${POSTS}&fields=guid,URL,title,date`) as Promise<{ posts?: unknown } | null>,
  ]);
  if (!list || !Array.isArray(list.posts)) return null;
  const items = (list.posts as RawPost[]).map(toPost).filter((p): p is WpcomPost => !!p);
  return { title: about?.title ?? '', siteUrl: about?.siteUrl ?? `https://${host}/`, imageUrl: about?.imageUrl, items };
}

const pathOf = (url: string) => new URL(url).pathname.replace(/\/+$/, '');

/** The post at this address, or null if WordPress.com has no such post (or doesn't host the site). */
export async function wpcomArticle(url: string): Promise<(WpcomArticle & { siteName?: string; iconUrl?: string }) | null> {
  const host = siteOf(url);
  // A post's address ends in its slug. The home page and other bare addresses have none.
  const slug = host && pathOf(url).split('/').pop();
  if (!host || !slug) return null;
  const [about, raw] = await Promise.all([
    site(host),
    ask(`${encodeURIComponent(host)}/posts/slug:${encodeURIComponent(slug)}?fields=guid,URL,title,date,content,author,featured_image`) as Promise<RawPost | null>,
  ]);
  const post = raw && toPost(raw);
  const contentHtml = raw && str(raw.content);
  // Two posts can share a slug under different dates; only take the one that was asked for.
  if (!post || !contentHtml || pathOf(post.link) !== pathOf(url)) return null;
  return {
    ...post,
    contentHtml,
    byline: plainText(raw.author?.name) || undefined,
    imageUrl: httpUrl(raw.featured_image),
    siteName: about?.title || undefined,
    iconUrl: about?.imageUrl,
  };
}
