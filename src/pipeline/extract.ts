import { Readability } from '@mozilla/readability';
import type { Settings } from '../db';

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

export class ExtractError extends Error {}

export async function fetchHtml(url: string, settings: Settings): Promise<{ html: string; finalUrl: string; status: number }> {
  const endpoint = `${settings.proxyUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`;
  let res: Response;
  try {
    res = await fetch(endpoint, { headers: { 'X-App-Secret': settings.proxySecret } });
  } catch {
    throw new ExtractError('Could not reach the fetch proxy. Is it running, and is the proxy URL right?');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    if (res.status === 401) throw new ExtractError('Proxy rejected the secret (check Settings).');
    throw new ExtractError(`Proxy error ${res.status}: ${body.error ?? res.statusText}`);
  }
  return {
    html: await res.text(),
    finalUrl: res.headers.get('X-Final-Url') ?? url,
    status: Number(res.headers.get('X-Upstream-Status') ?? 200),
  };
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
    throw new ExtractError('Could not find article text on this page. Try pasting the text instead.');
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
