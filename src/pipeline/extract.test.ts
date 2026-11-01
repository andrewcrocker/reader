import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../db';
import { ExtractError, loadArticle, proxyFailure, siteFailure, type Extracted } from './extract';

describe('loadArticle', () => {
  const url = 'https://example.com/story';
  const settings = { proxyUrl: 'https://proxy.test', proxySecret: 's' } as Settings;
  const blocked = () => new Response('wall', { headers: { 'X-Upstream-Status': '403' } });
  const parse = (html: string, finalUrl: string) =>
    ({ title: html, finalUrl, canonicalUrl: 'https://archive.ph/abc', method: 'readability', quality: html.includes('cut') ? 'partial' : 'full' }) as Extracted;

  /** Answers /fetch and each archive from a table of paths; anything else is "no snapshot". */
  const stub = (routes: Record<string, () => Response>) => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      seen.push(u);
      const hit = Object.keys(routes).find((k) => u.includes(k));
      return hit ? routes[hit]() : Response.json({ error: 'no snapshot' }, { status: 404 });
    }));
    return seen;
  };

  afterEach(() => vi.unstubAllGlobals());

  it('leaves archives alone when the page loads', async () => {
    const seen = stub({ '/fetch': () => new Response('page', { headers: { 'X-Upstream-Status': '200' } }) });
    expect((await loadArticle(url, settings, parse)).method).toBe('readability');
    expect(seen).toHaveLength(1);
  });

  it('uses an archived copy when the site blocks the fetch, filed under the original URL', async () => {
    stub({ '/fetch': blocked, 'source=archive-today': () => new Response('copy') });
    expect(await loadArticle(url, settings, parse)).toMatchObject({ method: 'archive-today', finalUrl: url, canonicalUrl: undefined });
  });

  it('falls back when the page loads but has no article text', async () => {
    stub({ '/fetch': () => new Response('stub', { headers: { 'X-Upstream-Status': '200' } }), 'source=wayback': () => new Response('copy') });
    const parseOrFail = (html: string, finalUrl: string) => {
      if (html === 'stub') throw new ExtractError('no text', 'page');
      return parse(html, finalUrl);
    };
    expect((await loadArticle(url, settings, parseOrFail)).method).toBe('wayback');
  });

  it('keeps looking past a cut-off copy, but uses it if nothing better turns up', async () => {
    stub({ '/fetch': blocked, 'source=wayback': () => new Response('cut'), 'source=archive-today': () => new Response('copy') });
    expect((await loadArticle(url, settings, parse)).method).toBe('archive-today');
    stub({ '/fetch': blocked, 'source=wayback': () => new Response('cut') });
    expect(await loadArticle(url, settings, parse)).toMatchObject({ method: 'wayback', quality: 'partial' });
  });

  it('says so when no archive has it', async () => {
    stub({ '/fetch': blocked });
    await expect(loadArticle(url, settings, parse)).rejects.toThrow('The site blocked the request (403). No archived copy was found either.');
  });

  it('skips archives when another copy could not help', async () => {
    const seen = stub({ '/fetch': () => Response.json({ error: 'unsupported content type: application/pdf' }, { status: 415 }) });
    await expect(loadArticle(url, settings, parse)).rejects.toThrow(/PDF/);
    expect(seen).toHaveLength(1);
    const again = stub({ '/fetch': () => Response.json({ error: 'proxy misconfigured' }, { status: 500 }) });
    await expect(loadArticle(url, settings, parse)).rejects.toMatchObject({ kind: 'service' });
    expect(again).toHaveLength(1);
  });
});

describe('proxyFailure', () => {
  it('blames the service when the proxy never answered (no JSON body)', () => {
    const e = proxyFailure(502, null);
    expect(e.kind).toBe('service');
    expect(e.message).toMatch(/Couldn’t reach the service/);
  });
  it('blames the service when it is not set up', () => {
    expect(proxyFailure(401, { error: 'unauthorized' }).kind).toBe('service');
  });
  it('blames the page for the Worker’s own upstream errors', () => {
    expect(proxyFailure(502, { error: 'upstream timed out' })).toMatchObject({ kind: 'page', message: 'The site took too long to respond.' });
    expect(proxyFailure(502, { error: 'upstream fetch failed' })).toMatchObject({ kind: 'page', message: 'The site couldn’t be reached.' });
    expect(proxyFailure(415, { error: 'unsupported content type: application/pdf' }).message).toMatch(/PDF/);
  });
});

describe('siteFailure', () => {
  it('passes 2xx/3xx and names common site errors', () => {
    expect(siteFailure(200)).toBeNull();
    expect(siteFailure(404)?.message).toBe('The page wasn’t found (404).');
    expect(siteFailure(403)?.message).toBe('The site blocked the request (403).');
    expect(siteFailure(503)?.kind).toBe('page');
  });
});
