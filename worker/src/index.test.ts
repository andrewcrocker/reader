import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { parseTarget, type Env } from './index';

const env = { APP_SECRET: 's3cret', ALLOWED_ORIGINS: 'http://localhost:5173' } as Env;
const req = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { 'X-App-Secret': 's3cret', ...headers } }, env);

afterEach(() => vi.unstubAllGlobals());

describe('parseTarget', () => {
  it.each([
    ['http://localhost/', false],
    ['http://10.0.0.5/', false],
    ['http://192.168.1.1/', false],
    ['http://[::1]/', false],
    ['http://169.254.169.254/latest', false],
    ['ftp://example.com/', false],
    ['https://user:pw@example.com/', false],
    ['https://example.com/a?b=c', true],
  ])('%s -> allowed=%s', (url, ok) => {
    expect(parseTarget(url) instanceof URL).toBe(ok);
  });
});

describe('/fetch', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await req('/fetch?url=https://example.com', { 'X-App-Secret': 'nope' })).status).toBe(401);
  });

  it('rejects disallowed browser origins', async () => {
    expect((await req('/fetch?url=https://example.com', { Origin: 'https://evil.test' })).status).toBe(403);
  });

  it('streams upstream HTML with metadata headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const r = new Response('<html><body>hi</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
      Object.defineProperty(r, 'url', { value: 'https://example.com/final' });
      return r;
    }));
    const res = await req('/fetch?url=https://example.com/start', { Origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Final-Url')).toBe('https://example.com/final');
    expect(res.headers.get('X-Upstream-Status')).toBe('200');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(await res.text()).toContain('hi');
  });

  it('refuses non-HTML content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } })));
    expect((await req('/fetch?url=https://example.com/a.pdf')).status).toBe(415);
  });
});

describe('/archive', () => {
  const article = 'https://example.com/story';
  const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

  it('fetches the Wayback snapshot as captured, keeping the original URL', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      seen.push(u);
      return u.includes('/wayback/available')
        ? Response.json({ archived_snapshots: { closest: { available: true, timestamp: '20261101120000' } } })
        : html('snapshot');
    }));
    const res = await req(`/archive?source=wayback&url=${encodeURIComponent(article)}`);
    expect(res.status).toBe(200);
    expect(seen[1]).toBe(`https://web.archive.org/web/20261101120000id_/${article}`);
    expect(res.headers.get('X-Final-Url')).toBe(article);
    expect(await res.text()).toBe('snapshot');
  });

  it('says 404 when Wayback has no snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ archived_snapshots: {} })));
    expect((await req(`/archive?source=wayback&url=${encodeURIComponent(article)}`)).status).toBe(404);
  });

  it('tells a missing archive.today snapshot apart from a blocked request', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      seen.push(u);
      return html('nope', 404);
    }));
    expect((await req(`/archive?source=archive-today&url=${encodeURIComponent(article)}`)).status).toBe(404);
    expect(seen[0]).toBe(`https://archive.ph/newest/${article}`);
    vi.stubGlobal('fetch', vi.fn(async () => html('captcha', 429)));
    expect((await req(`/archive?source=archive-today&url=${encodeURIComponent(article)}`)).status).toBe(502);
  });

  it('refuses unknown sources and private hosts', async () => {
    expect((await req(`/archive?source=other&url=${encodeURIComponent(article)}`)).status).toBe(400);
    expect((await req('/archive?source=wayback&url=http://127.0.0.1/x')).status).toBe(400);
  });
});

describe('/asset', () => {
  it('passes images through with CORP so the isolated app can load them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })));
    const res = await req('/asset?url=https://example.com/icon.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('refuses non-images and private hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })));
    expect((await req('/asset?url=https://example.com/page')).status).toBe(415);
    expect((await req('/asset?url=http://127.0.0.1/x.png')).status).toBe(400);
  });
});

describe('/ping', () => {
  it('says whether the secret is good', async () => {
    expect((await req('/ping')).status).toBe(204);
    expect((await req('/ping', { 'X-App-Secret': 'old' })).status).toBe(401);
  });
});
