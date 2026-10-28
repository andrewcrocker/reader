import { Readability } from '@mozilla/readability';
import type { Settings } from '../db';

export interface Extracted {
  finalUrl: string;
  canonicalUrl?: string;
  title: string;
  byline?: string;
  siteName?: string;
  imageUrl?: string;
  contentHtml: string;
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
    contentHtml: parsed.content,
    textLength: parsed.length ?? parsed.textContent?.length ?? 0,
    method: 'readability',
  };
}
