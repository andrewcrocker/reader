import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { parseTarget, type Env } from './index';

const env: Env = { APP_SECRET: 's3cret', ALLOWED_ORIGINS: 'http://localhost:5173' };
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
