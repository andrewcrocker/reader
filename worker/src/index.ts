import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { registerRenderRoutes, type RenderEnv } from './render';

export type Env = RenderEnv & {
  APP_SECRET: string;
  ALLOWED_ORIGINS: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const PROFILES = ['default', 'nocookie', 'referrer'] as const;
type Profile = (typeof PROFILES)[number];

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const app = new Hono<{ Bindings: Env }>();

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

app.use('*', (c, next) =>
  cors({
    origin: (origin) => (allowedOrigins(c.env).includes(origin) ? origin : null),
    allowHeaders: ['X-App-Secret', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Final-Url', 'X-Upstream-Status', 'X-Upstream-Content-Type', 'X-Chunk-Seconds'],
    maxAge: 86400,
  })(c, next),
);

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const origin = c.req.header('Origin');
  if (origin && !allowedOrigins(c.env).includes(origin)) {
    return c.json({ error: 'origin not allowed' }, 403);
  }
  if (!c.env.APP_SECRET) return c.json({ error: 'proxy misconfigured: APP_SECRET unset' }, 500);
  if (!secretMatches(c.req.header('X-App-Secret') ?? '', c.env.APP_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

/**
 * GET /fetch?url=…&profile=…
 *
 * Streams the upstream HTML body straight through instead of wrapping it in JSON
 * (see README: keeps the Worker well under the free plan's ~10 ms CPU budget).
 * Metadata travels in headers: X-Final-Url, X-Upstream-Status, X-Upstream-Content-Type.
 */
app.get('/fetch', async (c) => {
  const target = parseTarget(c.req.query('url'));
  if (typeof target === 'string') return c.json({ error: target }, 400);

  const profile = (c.req.query('profile') ?? 'default') as Profile;
  if (!PROFILES.includes(profile)) return c.json({ error: `unknown profile: ${profile}` }, 400);

  const headers = new Headers(BROWSER_HEADERS);
  if (profile === 'referrer') headers.set('Referer', 'https://www.google.com/');

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return c.json({ error: timedOut ? 'upstream timed out' : 'upstream fetch failed' }, 502);
  }

  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    return c.json({ error: `unsupported content type: ${contentType}`, status: upstream.status }, 415);
  }
  const declared = Number(upstream.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BYTES) return c.json({ error: 'page too large' }, 413);
  if (!upstream.body) return c.json({ error: 'empty upstream body', status: upstream.status }, 502);

  return new Response(upstream.body.pipeThrough(byteLimit(MAX_BYTES)), {
    status: 200,
    headers: {
      // Keep the upstream charset so the browser decodes correctly.
      'Content-Type': contentType || 'text/html',
      'X-Final-Url': upstream.url || target.toString(),
      'X-Upstream-Status': String(upstream.status),
      'X-Upstream-Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
});

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * GET /asset?url=…
 *
 * Image bytes for artwork (SPEC §4a, §13). The app stores what it gets locally, so this
 * is only hit once per image. image/* only, size-capped, streamed through.
 */
app.get('/asset', async (c) => {
  const target = parseTarget(c.req.query('url'));
  if (typeof target === 'string') return c.json({ error: target }, 400);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return c.json({ error: 'upstream fetch failed' }, 502);
  }
  if (!upstream.ok) return c.json({ error: `upstream status ${upstream.status}` }, 502);
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!/^image\//i.test(contentType)) return c.json({ error: `not an image: ${contentType}` }, 415);
  if (Number(upstream.headers.get('Content-Length') ?? 0) > MAX_IMAGE_BYTES) return c.json({ error: 'image too large' }, 413);
  if (!upstream.body) return c.json({ error: 'empty upstream body' }, 502);

  return new Response(upstream.body.pipeThrough(byteLimit(MAX_IMAGE_BYTES)), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // The app is cross-origin isolated (COEP require-corp); allow it to load this response.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'no-store',
    },
  });
});

registerRenderRoutes(app);

app.notFound((c) => c.json({ error: 'not found' }, 404));

/** Returns a URL, or an error message string. */
export function parseTarget(raw: string | undefined): URL | string {
  if (!raw) return 'missing url';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid url';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'only http(s) urls are allowed';
  if (url.username || url.password) return 'credentials in url are not allowed';
  if (isPrivateHost(url.hostname)) return 'private or local hosts are not allowed';
  return url;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (h.includes(':')) {
    return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  }
  return false;
}

function secretMatches(given: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function byteLimit(max: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) controller.error(new Error('page too large'));
      else controller.enqueue(chunk);
    },
  });
}

export default app;
