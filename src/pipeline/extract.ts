import { Readability } from '@mozilla/readability';
import type { Settings } from '../db';
import { noteInviteRejected } from '../app/invite';

export interface Extracted {
  finalUrl: string;
  canonicalUrl?: string;
  title: string;
  byline?: string;
  siteName?: string;
  imageUrl?: string;
  iconUrl?: string;
  contentHtml: string;
  /** SPEC §5 quality check: some text found, but it looks cut off or paywalled. */
  quality: 'full' | 'partial';
  textLength: number;
  method: string;
}

/**
 * A fetch/extract failure with a one-line reason a person can act on. `kind` says whose problem it
 * is: the page or site (`page`), or our fetch service not answering or not set up (`service`).
 */
export class ExtractError extends Error {
  constructor(
    message: string,
    readonly kind: 'page' | 'service',
  ) {
    super(message);
  }
}

const SERVICE_DOWN = 'Couldn’t reach the service that fetches pages. Check your connection and try again.';
const NOT_SET_UP = 'This app isn’t set up to fetch pages yet. Open your invite link again.';

/** Reason for a proxy error response. The Worker sends JSON `{ error }`; anything else means it never answered. */
export function proxyFailure(status: number, body: { error?: string } | null, contentType = ''): ExtractError {
  const page = (m: string) => new ExtractError(m, 'page');
  if (!body?.error) return new ExtractError(SERVICE_DOWN, 'service');
  if (status === 401 || status === 403 || status === 500) return new ExtractError(NOT_SET_UP, 'service');
  if (status === 400) return page('That doesn’t look like a web address.');
  if (status === 413) return page('This page is too large to load.');
  if (status === 415) return page(/pdf/i.test(body.error + contentType) ? 'This link is a PDF, which can’t be read yet.' : 'This link isn’t a web page.');
  if (/timed out/.test(body.error)) return page('The site took too long to respond.');
  if (status === 502) return page('The site couldn’t be reached.');
  return new ExtractError(SERVICE_DOWN, 'service');
}

/** Reason for an error status the site itself returned (the Worker passes it in X-Upstream-Status). */
export function siteFailure(status: number): ExtractError | null {
  if (status < 400) return null;
  const m =
    status === 404 || status === 410
      ? `The page wasn’t found (${status}).`
      : status === 401 || status === 403
        ? `The site blocked the request (${status}).`
        : status === 429
          ? 'The site is limiting requests. Try again later.'
          : status >= 500
            ? `The site had a problem (${status}). Try again later.`
            : `The site returned an error (${status}).`;
  return new ExtractError(m, 'page');
}

export async function fetchHtml(url: string, settings: Settings): Promise<{ html: string; finalUrl: string; status: number }> {
  const endpoint = `${settings.proxyUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`;
  let res: Response;
  try {
    res = await fetch(endpoint, { headers: { 'X-App-Secret': settings.proxySecret } });
  } catch {
    throw new ExtractError(SERVICE_DOWN, 'service');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 && body?.error) noteInviteRejected();
    throw proxyFailure(res.status, body, res.headers.get('Content-Type') ?? '');
  }
  const status = Number(res.headers.get('X-Upstream-Status') ?? 200);
  const bad = siteFailure(status);
  if (bad) throw bad;
  return { html: await res.text(), finalUrl: res.headers.get('X-Final-Url') ?? url, status };
}


export function parseArticle(html: string, finalUrl: string): Extracted {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // So Readability resolves relative links/images against the article, not the app.
  const base = doc.createElement('base');
  base.href = finalUrl;
  doc.head.prepend(base);

  const meta = (sel: string) => doc.querySelector<HTMLMetaElement>(sel)?.content?.trim() || undefined;
  const canonicalUrl = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || undefined;
  const imageUrl = meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  const ogSite = meta('meta[property="og:site_name"]');

  const iconUrl = bestTouchIcon(doc);
  const paywalled = declaresPaywall(doc);
  const declaredWords = declaredWordCount(doc);

  const parsed = new Readability(doc).parse();
  if (!parsed?.content || (parsed.textContent ?? '').trim().length < 200) {
    throw new ExtractError('We couldn’t find any article text on this page.', 'page');

  }
  return {
    finalUrl,
    canonicalUrl,
    title: parsed.title?.trim() || new URL(finalUrl).hostname,
    byline: parsed.byline?.trim() || undefined,
    siteName: parsed.siteName?.trim() || ogSite || new URL(finalUrl).hostname.replace(/^www\./, ''),
    imageUrl,
    iconUrl,
    contentHtml: parsed.content,
    textLength: parsed.length ?? parsed.textContent?.length ?? 0,
    method: 'readability',
    quality: assessQuality(parsed.textContent ?? '', { paywalled, declaredWords }),
  };
}

const PAYWALL_PHRASES = /(subscribe to (continue|read)|already a subscriber|this (article|story) is (for|available to) subscribers|to continue reading|sign in to (continue|read)|create a free account|you('ve| have) (reached|used) your (free )?(article )?limit|start your (free )?trial)/i;

/** SPEC §5: word count, paywall phrases near the end, declared paywall, abrupt truncation. */
export function assessQuality(text: string, opts: { paywalled?: boolean; declaredWords?: number } = {}): 'full' | 'partial' {
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean).length;
  const tail = clean.slice(-600);
  if (PAYWALL_PHRASES.test(tail)) return 'partial';
  if (opts.declaredWords && words < opts.declaredWords * 0.6) return 'partial';
  if (opts.paywalled && words < 600) return 'partial';
  if (/(…|\.\.\.)$/.test(clean) && words < 800) return 'partial';
  return 'full';
}

function jsonLd(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const v = JSON.parse(el.textContent ?? '');
      const items = Array.isArray(v) ? v : Array.isArray(v?.['@graph']) ? v['@graph'] : [v];
      for (const it of items) if (it && typeof it === 'object') out.push(it as Record<string, unknown>);
    } catch {
      /* malformed JSON-LD is common */
    }
  }
  return out;
}

function declaresPaywall(doc: Document): boolean {
  return jsonLd(doc).some((it) => it.isAccessibleForFree === false || it.isAccessibleForFree === 'False' || it.isAccessibleForFree === 'false');
}

function declaredWordCount(doc: Document): number | undefined {
  for (const it of jsonLd(doc)) {
    const n = Number(it.wordCount);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** Site art: the largest apple-touch-icon (SPEC §4a). Manifest icons and favicons aren't used yet. */
function bestTouchIcon(doc: Document): string | undefined {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]')];
  const size = (l: HTMLLinkElement) => Number(l.getAttribute('sizes')?.split('x')[0]) || 180;
  return links.sort((a, b) => size(b) - size(a))[0]?.href || undefined;
}
