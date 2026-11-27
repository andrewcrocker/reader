import type { Hono } from 'hono';

// Shared reading lists (spec/SHARING.md). The app publishes an opt-in, immutable snapshot of the
// articles the user loved: a small JSON file and the 1200x630 card image it drew itself. Anyone
// with the link can then open a public page (`/l/:id`) and fetch the card (`/l/:id/card.png`).
//
// This is the one place the Worker keeps data for longer than a render job, so it lives in its own
// R2 bucket (`LISTS`, no expiry) and never touches `AUDIO`, whose 7-day rule would delete it.

export type ListsEnv = {
  LISTS: R2Bucket;
  /** Origin the public links and og:image use (no trailing slash). Defaults to the origin the request came in on. */
  PUBLIC_BASE_URL?: string;
  /** The app's origin, for each item's "Open in Reader" link (`<app>/#add=<url>`). */
  APP_URL?: string;
  /** TODO(owner): where "Get Reader" on the public page points. Do not put the invite link (it carries the app secret) here. */
  PUBLIC_CTA_URL?: string;
};

export const MAX_ITEMS = 50;
export const MAX_CARD_BYTES = 1024 * 1024;
/** The JSON half of the upload: 50 items of capped strings is well under this. */
const MAX_META_CHARS = 64 * 1024;
/** Whole multipart body: the card, the JSON and the multipart framing. */
const MAX_BODY_BYTES = MAX_CARD_BYTES + MAX_META_CHARS + 16 * 1024;

const LIMITS = { title: 120, name: 40, note: 200, itemTitle: 200, domain: 100, byline: 100, url: 2048 } as const;
export const RANGES = ['week', 'all'] as const;
export type ListRange = (typeof RANGES)[number];

export interface ListItem {
  title: string;
  url: string;
  domain: string;
  byline?: string;
  /** Listening time at 1.0x, whole minutes. */
  minutes?: number;
  /** `#rrggbb`: the article's own color, for its tile. */
  tint?: string;
}

export interface ListInput {
  title: string;
  note?: string;
  name?: string;
  range: ListRange;
  items: ListItem[];
}

/** What is stored at `lists/<id>.json`. */
export interface StoredList extends ListInput {
  v: 1;
  id: string;
  createdAt: number;
}

// ---- Validation ----

/** Control characters become spaces, runs of whitespace collapse, and the result is cut to `max` characters (not UTF-16 units). */
export function tidy(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : s;
}

/** An http(s) URL without credentials, or undefined. */
export function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > LIMITS.url) return undefined;
  try {
    const u = new URL(value.trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Returns the cleaned request, or the reason it was refused. Text fields are capped (a web page's
 * title can be any length); structure, counts and URLs are refused, because a half-valid list would
 * publish something the sender didn't mean to.
 */
export function parseListRequest(body: unknown): ListInput | string {
  if (!body || typeof body !== 'object') return 'expected a JSON object';
  const { title, note, name, range, items } = body as Record<string, unknown>;
  const t = tidy(title, LIMITS.title);
  if (!t) return 'missing title';
  if (!(RANGES as readonly unknown[]).includes(range)) return 'unknown range';
  if (!Array.isArray(items) || !items.length) return 'no items';
  if (items.length > MAX_ITEMS) return `too many items (at most ${MAX_ITEMS})`;

  const clean: ListItem[] = [];
  for (const [i, raw] of items.entries()) {
    if (!raw || typeof raw !== 'object') return `item ${i} is not an object`;
    const it = raw as Record<string, unknown>;
    const url = httpUrl(it.url);
    if (!url) return `item ${i} needs an http(s) url`;
    const itemTitle = tidy(it.title, LIMITS.itemTitle);
    if (!itemTitle) return `item ${i} needs a title`;
    const item: ListItem = { title: itemTitle, url, domain: tidy(it.domain, LIMITS.domain) ?? new URL(url).hostname.replace(/^www\./, '') };
    const byline = tidy(it.byline, LIMITS.byline);
    if (byline) item.byline = byline;
    if (typeof it.minutes === 'number' && Number.isFinite(it.minutes) && it.minutes >= 1) item.minutes = Math.min(600, Math.round(it.minutes));
    if (typeof it.tint === 'string' && HEX.test(it.tint)) item.tint = it.tint.toLowerCase();
    clean.push(item);
  }

  const out: ListInput = { title: t, range: range as ListRange, items: clean };
  const n = tidy(note, LIMITS.note);
  if (n) out.note = n;
  const who = tidy(name, LIMITS.name);
  if (who) out.name = who;
  return out;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b: Uint8Array) => b.length > 24 && PNG_MAGIC.every((v, i) => b[i] === v);

// ---- Ids ----

/** Crockford's base32 (no i, l, o, u): 32 symbols, so a random byte maps onto it without bias. */
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_LENGTH = 10;

export function newListId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return [...bytes].map((b) => ID_ALPHABET[b & 31]).join('');
}

/** What a route accepts as an id. Wider than `newListId` makes, so a typo gets a 404 rather than a 401. */
const ID_PARAM = /^[0-9a-z]{1,32}$/;

const jsonKey = (id: string) => `lists/${id}.json`;
const cardKey = (id: string) => `lists/${id}.png`;

// ---- The public routes, and how the auth middleware knows them ----

/**
 * The only requests that skip the app secret and the origin allowlist: reading a published list or
 * its card. Anchored and method-checked on purpose; anything else (including these paths with a
 * different method, a trailing slash or extra segments) still goes through the secret.
 */
export function isPublicListRoute(method: string, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && /^\/l\/[0-9a-z]{1,32}(\/card\.png)?$/.test(path);
}

const baseUrl = (env: ListsEnv, requestUrl: string) => (env.PUBLIC_BASE_URL?.trim() || new URL(requestUrl).origin).replace(/\/+$/, '');

export function registerListRoutes<E extends ListsEnv>(app: Hono<{ Bindings: E }>) {
  /**
   * POST /lists (app secret required): multipart with `meta` (JSON, see `parseListRequest`) and
   * `card` (the PNG). Stores the snapshot and answers 201 `{ id, url }`.
   */
  app.post('/lists', async (c) => {
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_BODY_BYTES) return c.json({ error: 'upload too large' }, 413);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'expected multipart form data with meta and card' }, 400);
    }
    const meta = form.get('meta');
    const card = form.get('card');
    if (typeof meta !== 'string') return c.json({ error: 'missing meta' }, 400);
    if (meta.length > MAX_META_CHARS) return c.json({ error: 'meta too large' }, 413);
    if (!card || typeof card === 'string') return c.json({ error: 'missing card' }, 400);
    if (card.size > MAX_CARD_BYTES) return c.json({ error: 'card too large (1 MB at most)' }, 413);

    let json: unknown;
    try {
      json = JSON.parse(meta);
    } catch {
      return c.json({ error: 'meta is not JSON' }, 400);
    }
    const parsed = parseListRequest(json);
    if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
    const png = new Uint8Array(await card.arrayBuffer());
    if (!isPng(png)) return c.json({ error: 'card must be a PNG' }, 400);

    let id = newListId();
    for (let tries = 0; tries < 4 && (await c.env.LISTS.head(jsonKey(id))); tries++) id = newListId();
    const stored: StoredList = { v: 1, id, createdAt: Date.now(), ...parsed };
    // The JSON goes last: a list exists once it can be read, and by then its card is already there.
    await c.env.LISTS.put(cardKey(id), png, { httpMetadata: { contentType: 'image/png' } });
    await c.env.LISTS.put(jsonKey(id), JSON.stringify(stored), { httpMetadata: { contentType: 'application/json' } });
    return c.json({ id, url: `${baseUrl(c.env, c.req.url)}/l/${id}` }, 201);
  });

  /** GET /l/:id (public): the list as a web page. */
  app.get('/l/:id', async (c) => {
    const id = c.req.param('id');
    const obj = ID_PARAM.test(id) ? await c.env.LISTS.get(jsonKey(id)) : null;
    const stored = obj ? await obj.json<StoredList>().catch(() => null) : null;
    const list = stored && Array.isArray(stored.items) && typeof stored.title === 'string' ? stored : null;
    const nonce = crypto.randomUUID().replace(/-/g, '');
    if (!list) return pageResponse(renderMissingPage(nonce), nonce, 404);
    const html = renderListPage(list, { baseUrl: baseUrl(c.env, c.req.url), appUrl: c.env.APP_URL, ctaUrl: c.env.PUBLIC_CTA_URL || c.env.APP_URL, nonce });
    return pageResponse(html, nonce, 200);
  });

  /** GET /l/:id/card.png (public): the share image. A snapshot never changes, so it caches for good. */
  app.get('/l/:id/card.png', async (c) => {
    const id = c.req.param('id');
    const obj = ID_PARAM.test(id) ? await c.env.LISTS.get(cardKey(id)) : null;
    if (!obj) return c.text('Not found', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Robots-Tag': 'noindex',
      },
    });
  });
}

// ---- The page ----

function pageResponse(html: string, nonce: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No scripts at all. Styles are one nonced block, so nothing user-supplied can restyle the page.
      'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff',
      // Links out to the articles carry our origin but never this page's path, which is the list's secret-ish id.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
  });
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** For text and for quoted attribute values. Every string that came from a user goes through this. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** A link target that is http(s) and nothing else (the POST already guarantees it; this guards what's in storage). */
const safeHref = (u: string): string | undefined => httpUrl(u);

function initials(domain: string): string {
  const words = domain.replace(/^(www|en|m)\./, '').replace(/\.(com|org|net|io|co|dev|blog|news|me|limo)$/i, '').split(/[\s.\-_]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const mark = words.length >= 2 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? '·');
  return mark.toUpperCase();
}

/** Whichever of the two inks reads better on the tile. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Luminance of #1b1a19 is about 0.01 and of #f3f2f0 about 0.89.
  return (lum + 0.05) / 0.06 > 0.94 / (lum + 0.05) ? '#1b1a19' : '#f3f2f0';
}

const RANGE_LABEL: Record<ListRange, string> = { week: 'This week', all: 'All time' };

/** The soft heart from the app's icon set (src/ui/heart.ts), 24x24: the eyebrow's glyph, as on the card. */
const HEART = 'M12 20.1C9.2 18.3 3.6 14.6 3.6 9.5C3.6 6.7 5.6 4.7 8.1 4.7C9.8 4.7 11.2 5.6 12 7.1C12.8 5.6 14.2 4.7 15.9 4.7C18.4 4.7 20.4 6.7 20.4 9.5C20.4 14.6 14.8 18.3 12 20.1Z';
/** The app's play glyph (src/ui/Icon.tsx). */
const PLAY = 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z';

/** "45 m", "2 h 17 m", "21 h": the app's own duration style. Same rules as the card (src/share/card.ts). */
export function fmtTotal(minutes: number): string {
  const min = Math.max(1, Math.round(minutes));
  if (min < 60) return `${min} m`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min / 60} h`;
}

/** "25:00", "1:05:00": a length in minutes as a clock, for the player's right-hand time. */
export function fmtClock(minutes: number): string {
  const sec = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec % 60)}` : `${m}:${two(sec % 60)}`;
}

/** Listening time of the whole list in minutes (articles whose length isn't known add nothing), or undefined if none is known. */
export function totalMinutes(list: Pick<StoredList, 'items'>): number | undefined {
  const sum = list.items.reduce((n, it) => n + (typeof it.minutes === 'number' ? it.minutes : 0), 0);
  return sum > 0 ? sum : undefined;
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One sentence for link previews: the first few titles and how many more there are. */
export function describeList(list: StoredList): string {
  const shown = list.items.slice(0, 3).map((i) => i.title);
  const rest = list.items.length - shown.length;
  const summary = `${plural(list.items.length, 'article')}: ${shown.join(' · ')}${rest > 0 ? ` and ${rest} more` : ''}`;
  const text = list.note ? `${list.note} — ${summary}` : summary;
  const chars = [...text];
  return chars.length > 200 ? `${chars.slice(0, 199).join('')}…` : text;
}

const STYLE = `
:root{--bg:#f3f2f0;--surface:#f9f8f6;--fg:#1b1a19;--muted:#575652;--line:#d9d7d3;--fill:#e2e0dd;--accent:#1f5c55;--on-accent:#f3f2f0;
--mini-bg:#1b1a19;--mini-fg:#f3f2f0;--mini-muted:#bcbab5;--play:#8fd0c3;--on-play:#0f2420;
--serif:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#151413;--surface:#1d1c1b;--fg:#e8e6e3;--muted:#a2a09b;--line:#292826;--fill:#282726;--accent:#8fd0c3;--on-accent:#0f2420;--mini-bg:#272624;--mini-fg:#e8e6e3;--mini-muted:#adaba6}}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 var(--sans)}
main{max-width:640px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) 20px 56px}
a{color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--muted);font-weight:600;font-size:15px;text-decoration:none}
.mark{width:30px;height:30px;border-radius:9px;background:#14161a;box-shadow:0 0 0 1px var(--line);display:grid;place-items:center}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.get{padding:8px 16px;border:1.5px solid var(--line);border-radius:20px;color:var(--fg);font-size:14px;font-weight:600;text-decoration:none}
.get:hover{border-color:var(--muted)}
.eyebrow{display:flex;align-items:center;gap:8px;margin:40px 0 12px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.heart{flex:none;width:18px;height:18px;fill:currentColor}
h1{margin:0;font:500 clamp(36px,10vw,56px)/1.06 var(--serif);letter-spacing:-.015em;text-wrap:balance}
.note{margin:22px 0 0;padding-left:16px;border-left:3px solid var(--accent);font:italic 400 19px/1.5 var(--serif);color:var(--muted)}
.player{margin:32px 0 0;padding:20px 20px 16px;border-radius:24px;background:var(--mini-bg);color:var(--mini-fg);box-shadow:0 18px 40px rgba(20,16,10,.16)}
.np{display:flex;align-items:center;gap:16px}
.np .tile{flex:none;width:60px;height:60px;border-radius:13px;font-size:20px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.np-text{min-width:0}
.np-title{margin:0;font:500 20px/1.25 var(--serif);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.np-site{margin:4px 0 0;font-size:14px;color:var(--mini-muted);overflow-wrap:anywhere}
.scrub{margin-top:20px}
.bar{display:block;position:relative;height:4px;border-radius:2px;background:rgba(143,208,195,.32)}
.bar::after{content:"";position:absolute;left:0;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:var(--play)}
.times{display:flex;justify-content:space-between;margin-top:9px;font-size:13px;color:var(--mini-muted);font-variant-numeric:tabular-nums}
.play{display:flex;align-items:center;gap:16px;margin-top:12px;color:var(--mini-fg);text-decoration:none}
.play:focus-visible{outline-color:var(--play)}
.disc{flex:none;width:72px;height:72px;border-radius:50%;background:var(--play);color:var(--on-play);display:grid;place-items:center;box-shadow:0 0 30px rgba(143,208,195,.3)}
.disc svg{width:34px;height:34px;margin-left:3px;fill:currentColor}
.play-text{display:flex;flex-direction:column;min-width:0}
.play-label{font-weight:600;font-size:19px;color:var(--play)}
.play-hint{margin-top:2px;font-size:14px;color:var(--mini-muted)}
.play:hover .play-label{text-decoration:underline;text-underline-offset:3px}
.total{margin:14px 0 0;padding-top:12px;border-top:1px solid rgba(255,255,255,.1);font-size:14px;color:var(--mini-muted);font-variant-numeric:tabular-nums}
.list{list-style:none;counter-reset:n;margin:28px 0 0;padding:0;border-top:1px solid var(--line)}
.item{counter-increment:n;display:grid;grid-template-columns:20px 48px minmax(0,1fr);gap:14px;padding:20px 0;border-bottom:1px solid var(--line)}
.item::before{content:counter(n);font:500 15px/48px var(--sans);color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.item:first-child::before{color:var(--accent);font-weight:600}
.tile{width:48px;height:48px;border-radius:10px;display:grid;place-items:center;font:600 15px var(--serif);background:var(--fill)}
.title{display:block;color:var(--fg);font:500 19px/1.3 var(--serif);text-decoration:none;overflow-wrap:anywhere}
.title:hover{text-decoration:underline;text-underline-offset:3px}
.meta{margin:6px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.open{display:inline-block;margin-top:10px;font-size:14px;font-weight:600;text-decoration:none}
.open:hover{text-decoration:underline;text-underline-offset:3px}
.cta{margin-top:48px;padding:28px 24px;border-radius:20px;background:var(--surface);border:1px solid var(--line)}
.cta h2{margin:0;font:500 26px/1.2 var(--serif);letter-spacing:-.01em}
.cta p{margin:12px 0 0;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;height:52px;margin-top:22px;padding:0 28px;border-radius:26px;background:var(--accent);color:var(--on-accent);font-weight:600;font-size:16px;text-decoration:none}
.foot{margin:28px 0 0;font-size:13px;color:var(--muted)}
@media (min-width:700px){main{padding-top:48px}.item{grid-template-columns:24px 56px minmax(0,1fr);gap:18px}.item::before{line-height:56px}.tile{width:56px;height:56px;border-radius:12px;font-size:17px}.np .tile{width:68px;height:68px;border-radius:14px;font-size:22px}.np-title{font-size:23px}.player{padding:24px 28px 18px}.title{font-size:21px}.cta{padding:36px 36px}}
@media (prefers-reduced-motion:no-preference){.btn,.title,.open{transition:opacity .15s}.btn:hover{opacity:.9}}
`;

/** The app's mark: an amber play triangle on near-black (the same artwork as the app icon). */
const MARK = '<svg width="30" height="30" viewBox="0 0 192 192" aria-hidden="true"><rect width="192" height="192" rx="40" fill="#14161a"/><path d="M66 55v83l75-41z" fill="#f2b84b"/></svg>';

function shell(opts: { title: string; nonce: string; head?: string; css?: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f2f0">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#151413">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
${opts.head ?? ''}<style nonce="${opts.nonce}">${STYLE}${opts.css ?? ''}</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}

function renderMissingPage(nonce: string): string {
  return shell({
    title: 'List not found · Reader',
    nonce,
    body: `<main><span class="brand"><span class="mark">${MARK}</span>Reader</span><p class="eyebrow">Not found</p><h1>This list isn’t here.</h1><p class="note">The link may be mistyped, or the list is gone.</p></main>`,
  });
}

export interface PageOptions {
  /** Origin for the absolute og:url and og:image. */
  baseUrl: string;
  appUrl?: string;
  ctaUrl?: string;
  nonce: string;
}

export function renderListPage(list: StoredList, o: PageOptions): string {
  const pageUrl = `${o.baseUrl}/l/${list.id}`;
  const cardUrl = `${pageUrl}/card.png`;
  const description = describeList(list);
  const headline = list.title;
  const alt = `${headline}. ${list.items.slice(0, 3).map((i) => i.title).join(', ')}${list.items.length > 3 ? `, and ${list.items.length - 3} more` : ''}`;
  const appBase = o.appUrl && httpUrl(o.appUrl) ? o.appUrl.replace(/\/+$/, '') : undefined;
  const cta = o.ctaUrl && httpUrl(o.ctaUrl) ? o.ctaUrl : undefined;

  const head = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(pageUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Reader">`,
    `<meta property="og:title" content="${esc(headline)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta property="og:image" content="${esc(cardUrl)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(headline)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(cardUrl)}">`,
    `<meta name="twitter:image:alt" content="${esc(alt)}">`,
    '',
  ].join('\n');

  // Per-item tile colors are classes in the nonced stylesheet (an inline style="" would need 'unsafe-inline'). The values are validated `#rrggbb`.
  const tileCss: string[] = [];
  const items = list.items
    .map((it, i) => {
      const href = safeHref(it.url);
      const tint = it.tint && /^#[0-9a-f]{6}$/.test(it.tint) ? it.tint : undefined;
      if (tint) tileCss.push(`.t${i}{background:${tint};color:${inkFor(tint)}}`);
      const meta = [it.domain, it.minutes ? `${it.minutes} min` : undefined, it.byline].filter(Boolean).map((s) => esc(s as string)).join(' · ');
      const title = href ? `<a class="title" href="${esc(href)}" target="_blank" rel="noopener nofollow ugc">${esc(it.title)}</a>` : `<span class="title">${esc(it.title)}</span>`;
      const open = href && appBase ? `<a class="open" href="${esc(`${appBase}/#add=${encodeURIComponent(href)}`)}" aria-label="${esc(`Open “${it.title}” in Reader`)}">Open in Reader</a>` : '';
      return `<li class="item"><span class="tile${tint ? ` t${i}` : ''}" aria-hidden="true">${esc(initials(it.domain))}</span><div>${title}<p class="meta">${meta}</p>${open}</div></li>`;
    })
    .join('\n');

  const eyebrow = `${RANGE_LABEL[list.range]} · ${plural(list.items.length, 'article')}`;

  // The player: the card's own look, so whoever taps the preview lands on what they saw. Recipients can't
  // stream audio, so the play button is a link and says where it goes: the first article added to their
  // Reader (the same `#add=` link as "Open in Reader") or, without that, the "Get Reader" page. No script,
  // no playback; the bar and clock only echo the card.
  const first = list.items[0];
  const firstHref = first ? safeHref(first.url) : undefined;
  const playHref = appBase && firstHref ? `${appBase}/#add=${encodeURIComponent(firstHref)}` : cta;
  const playHint = appBase && firstHref ? 'Opens in Reader' : 'Get Reader to listen';
  const minutes = totalMinutes(list);
  const firstTint = first?.tint && /^#[0-9a-f]{6}$/.test(first.tint);
  const player = first
    ? `<section class="player" aria-label="${esc(`Play ${headline}`)}">
<div class="np"><span class="tile${firstTint ? ' t0' : ''}" aria-hidden="true">${esc(initials(first.domain))}</span><div class="np-text"><p class="np-title">${esc(first.title)}</p><p class="np-site">${esc(first.domain)}</p></div></div>
<div class="scrub" aria-hidden="true"><span class="bar"></span><span class="times"><span>0:00</span><span>${first.minutes ? fmtClock(first.minutes) : ''}</span></span></div>
${playHref ? `<a class="play" href="${esc(playHref)}"><span class="disc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${PLAY}"/></svg></span><span class="play-text"><span class="play-label">Listen on Reader</span><span class="play-hint">${playHint}</span></span></a>` : ''}
<p class="total">${esc(plural(list.items.length, 'article'))}${minutes ? ` · ${esc(fmtTotal(minutes))} total` : ''}</p>
</section>`
    : '';
  const body = `<main>
<div class="top"><a class="brand" href="${esc(cta ?? pageUrl)}"><span class="mark">${MARK}</span>Reader</a>${cta ? `<a class="get" href="${esc(cta)}">Get Reader</a>` : ''}</div>
<p class="eyebrow"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>${esc(eyebrow)}</p>
<h1>${esc(headline)}</h1>
${list.note ? `<p class="note">${esc(list.note)}</p>` : ''}
${player}
<ol class="list" aria-label="${esc(headline)}">
${items}
</ol>
<section class="cta" aria-labelledby="cta-h">
<h2 id="cta-h">Read it, or have it read to you.</h2>
<p>Reader turns any article into audio you can play later, on a walk, a commute or offline. Share an article from your phone and it’s ready when you press play.</p>
${cta ? `<a class="btn" href="${esc(cta)}">Get Reader</a>` : ''}
</section>
<p class="foot">A snapshot of the reading list, shared with Reader. Each link goes to the original article.</p>
</main>`;

  return shell({ title: `${headline} · Reader`, nonce: o.nonce, head, css: tileCss.join(''), body });
}
