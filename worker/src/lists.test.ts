import { describe, expect, it } from 'vitest';
import app, { type Env } from './index';
import { describeList, esc, fmtClock, fmtTotal, httpUrl, isPng, isPublicListRoute, newListId, parseListRequest, renderListPage, tidy, totalMinutes, type StoredList } from './lists';

// A tiny in-memory R2: just the calls lists.ts makes.
function fakeLists() {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  const bucket = {
    head: async (key: string) => (store.has(key) ? { key } : null),
    put: async (key: string, value: string | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { body: typeof value === 'string' ? new TextEncoder().encode(value) : value, contentType: opts?.httpMetadata?.contentType });
    },
    get: async (key: string) => {
      const o = store.get(key);
      return o ? { body: o.body, json: async () => JSON.parse(new TextDecoder().decode(o.body)), text: async () => new TextDecoder().decode(o.body) } : null;
    },
  };
  return { store, bucket };
}

const SECRET = 's3cret';
const ORIGIN = 'http://localhost:5173';
function makeEnv(extra: Partial<Env> = {}) {
  const { store, bucket } = fakeLists();
  const env = { APP_SECRET: SECRET, ALLOWED_ORIGINS: ORIGIN, LISTS: bucket, APP_URL: 'https://app.example', ...extra } as unknown as Env;
  return { env, store };
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

/** 8 PNG signature bytes plus enough padding to clear the length check. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(7)]);

const item = (n: number, over: Record<string, unknown> = {}) => ({ title: `Article ${n}`, url: `https://example.com/post-${n}`, domain: 'example.com', minutes: 8, tint: '#2e4057', ...over });
const validBody = (over: Record<string, unknown> = {}) => ({ title: 'Zach’s reading this week', range: 'week', items: [item(1), item(2)], ...over });

function upload(body: unknown, card: Uint8Array | string | null = PNG) {
  const form = new FormData();
  form.set('meta', typeof body === 'string' ? body : JSON.stringify(body));
  if (typeof card === 'string') form.set('card', card);
  else if (card !== null) form.set('card', new Blob([card], { type: 'image/png' }), 'card.png');
  return form;
}
const post = (env: Env, form: FormData | string, headers: Record<string, string> = { 'X-App-Secret': SECRET }) => app.request('/lists', { method: 'POST', body: form, headers }, env, ctx);

/** Publishes through the real route and returns the id. */
async function publish(env: Env, body: unknown = validBody()) {
  const res = await post(env, upload(body));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string; url: string }).id;
}

describe('parseListRequest', () => {
  it('accepts a well-formed list and normalizes it', () => {
    const out = parseListRequest(validBody({ name: 'Zach', note: 'Start with the first one.', items: [item(1, { tint: '#2E4057', byline: 'V. B.' })] }));
    expect(out).toEqual({
      title: 'Zach’s reading this week',
      range: 'week',
      name: 'Zach',
      note: 'Start with the first one.',
      items: [{ title: 'Article 1', url: 'https://example.com/post-1', domain: 'example.com', byline: 'V. B.', minutes: 8, tint: '#2e4057' }],
    });
  });

  it.each([
    ['not an object', null, /object/],
    ['no title', validBody({ title: '   ' }), /title/],
    ['unknown range', validBody({ range: 'month' }), /range/],
    ['no items', validBody({ items: [] }), /no items/],
    ['items not an array', validBody({ items: 'x' }), /no items/],
    ['more than 50 items', validBody({ items: Array.from({ length: 51 }, (_, i) => item(i)) }), /too many/],
    ['item without a title', validBody({ items: [item(1, { title: '' })] }), /title/],
    ['item that is not an object', validBody({ items: ['https://example.com'] }), /object/],
  ])('refuses %s', (_name, body, msg) => {
    expect(parseListRequest(body)).toMatch(msg);
  });

  it('allows exactly 50 items', () => {
    const out = parseListRequest(validBody({ items: Array.from({ length: 50 }, (_, i) => item(i)) }));
    expect(typeof out).toBe('object');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/file',
    'file:///etc/passwd',
    '//example.com/x',
    '/relative',
    'https://user:pw@example.com/',
    'not a url',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('refuses the item url %s', (url) => {
    expect(parseListRequest(validBody({ items: [item(1, { url })] }))).toMatch(/http\(s\) url/);
  });

  it('caps text instead of refusing it, and cleans control characters', () => {
    const out = parseListRequest(validBody({ title: 'T'.repeat(500), name: 'N'.repeat(500), note: 'line one\nline two\u0000', items: [item(1, { title: 'x'.repeat(900), byline: 'b'.repeat(900) })] })) as Exclude<ReturnType<typeof parseListRequest>, string>;
    expect([...out.title]).toHaveLength(120);
    expect([...out.name!]).toHaveLength(40);
    expect(out.note).toBe('line one line two');
    expect([...out.items[0].title]).toHaveLength(200);
    expect([...out.items[0].byline!]).toHaveLength(100);
    expect(out.title.endsWith('…')).toBe(true);
  });

  it('drops a bad tint and a bad minutes value, and derives a missing domain from the url', () => {
    const out = parseListRequest(validBody({ items: [{ title: 'A', url: 'https://www.example.org/a', tint: 'red', minutes: -3 }] })) as { items: Record<string, unknown>[] };
    expect(out.items[0]).toEqual({ title: 'A', url: 'https://www.example.org/a', domain: 'example.org' });
  });

  it('does not cut an emoji in half when capping', () => {
    expect(tidy('😀'.repeat(10), 5)).toBe('😀😀😀😀…');
  });
});

describe('helpers', () => {
  it('only treats http(s) without credentials as a link', () => {
    expect(httpUrl('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d');
    expect(httpUrl('javascript:alert(1)')).toBeUndefined();
    expect(httpUrl(42)).toBeUndefined();
  });

  it('recognizes PNG bytes', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new Uint8Array(64))).toBe(false);
    expect(isPng(new TextEncoder().encode('<html><script>alert(1)</script></html>'))).toBe(false);
  });

  it('makes URL-safe ids of about 10 characters that do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newListId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{10}$/);
  });

  it('escapes the five HTML characters', () => {
    expect(esc(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('player helpers', () => {
  it('writes the total listening time in the app’s style', () => {
    expect(fmtTotal(0.2)).toBe('1 m');
    expect(fmtTotal(45)).toBe('45 m');
    expect(fmtTotal(60)).toBe('1 h');
    expect(fmtTotal(137)).toBe('2 h 17 m');
    expect(fmtTotal(1260)).toBe('21 h');
  });

  it('writes a length as a clock', () => {
    expect(fmtClock(25)).toBe('25:00');
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(75)).toBe('1:15:00');
  });

  it('totals the minutes it knows', () => {
    const items = (mins: (number | undefined)[]) => ({ items: mins.map((minutes) => ({ title: 't', url: 'https://a.test/', domain: 'a.test', minutes })) });
    expect(totalMinutes(items([10, 20, undefined, 5]))).toBe(35);
    expect(totalMinutes(items([undefined]))).toBeUndefined();
    expect(totalMinutes(items([]))).toBeUndefined();
  });
});

describe('isPublicListRoute', () => {
  it.each([
    ['GET', '/l/abc123defg', true],
    ['HEAD', '/l/abc123defg', true],
    ['GET', '/l/abc123defg/card.png', true],
    ['POST', '/l/abc123defg', false],
    ['DELETE', '/l/abc123defg', false],
    ['PUT', '/l/abc123defg/card.png', false],
    ['GET', '/l', false],
    ['GET', '/l/', false],
    ['GET', '/l/abc123defg/', false],
    ['GET', '/l/abc123defg/card.png/', false],
    ['GET', '/l/abc123defg/other', false],
    ['GET', '/l/abc123defg/card.png.html', false],
    ['GET', '/l/ABC', false],
    ['GET', '/l/ab.c', false],
    ['GET', '/l/../fetch', false],
    ['GET', '/lists', false],
    ['GET', '/lists/abc', false],
    ['GET', '/fetch', false],
    ['GET', '/render/0f8fad5b-d9cb-469f-a165-70867728950e', false],
    ['GET', '/', false],
  ])('%s %s -> %s', (method, path, expected) => {
    expect(isPublicListRoute(method, path)).toBe(expected);
  });
});

describe('POST /lists', () => {
  it('stores the snapshot and the card, and returns the public url', async () => {
    const { env, store } = makeEnv();
    const res = await post(env, upload(validBody({ name: 'Zach' })), { 'X-App-Secret': SECRET, Origin: ORIGIN });
    expect(res.status).toBe(201);
    const { id, url } = (await res.json()) as { id: string; url: string };
    expect(id).toMatch(/^[0-9a-z]{10}$/);
    // No PUBLIC_BASE_URL: the origin the request came in on.
    expect(url).toBe(`http://localhost/l/${id}`);
    expect([...store.keys()].sort()).toEqual([`lists/${id}.json`, `lists/${id}.png`]);
    expect(store.get(`lists/${id}.png`)!.contentType).toBe('image/png');
    const saved = JSON.parse(new TextDecoder().decode(store.get(`lists/${id}.json`)!.body));
    expect(saved).toMatchObject({ v: 1, id, name: 'Zach', range: 'week' });
    expect(typeof saved.createdAt).toBe('number');
    expect(saved.items).toHaveLength(2);
  });

  it('builds the url from PUBLIC_BASE_URL when it is set', async () => {
    const { env } = makeEnv({ PUBLIC_BASE_URL: 'https://reader.example.com/' });
    const { url } = (await (await post(env, upload(validBody()))).json()) as { url: string };
    expect(url).toMatch(/^https:\/\/reader\.example\.com\/l\/[0-9a-z]{10}$/);
  });

  it('never writes anywhere but lists/', async () => {
    const { env, store } = makeEnv();
    await publish(env);
    expect([...store.keys()].every((k) => k.startsWith('lists/'))).toBe(true);
  });

  it('needs the app secret and an allowed origin', async () => {
    const { env, store } = makeEnv();
    expect((await post(env, upload(validBody()), {})).status).toBe(401);
    expect((await post(env, upload(validBody()), { 'X-App-Secret': 'nope' })).status).toBe(401);
    expect((await post(env, upload(validBody()), { 'X-App-Secret': SECRET, Origin: 'https://evil.test' })).status).toBe(403);
    expect(store.size).toBe(0);
  });

  it.each([
    ['not multipart', 'plain text', 400, /multipart/],
    ['meta missing', (() => { const f = new FormData(); f.set('card', new Blob([PNG]), 'c.png'); return f; })(), 400, /meta/],
    ['card missing', upload(validBody(), null), 400, /card/],
    ['meta not JSON', upload('{nope'), 400, /JSON/],
    ['card sent as text', upload(validBody(), 'not a file'), 400, /card/],
    ['card not a PNG', upload(validBody(), new TextEncoder().encode('<script>alert(1)</script>'.padEnd(64, ' '))), 400, /PNG/],
    ['card over 1 MB', upload(validBody(), (() => { const b = new Uint8Array(1024 * 1024 + 1); b.set(PNG); return b; })()), 413, /too large/],
    ['an invalid list', upload(validBody({ items: [item(1, { url: 'javascript:alert(1)' })] })), 400, /http\(s\)/],
    ['too many items', upload(validBody({ items: Array.from({ length: 51 }, (_, i) => item(i)) })), 400, /too many/],
  ] as const)('refuses %s', async (_name, form, status, msg) => {
    const { env, store } = makeEnv();
    const res = await post(env, form as FormData | string);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toMatch(msg);
    expect(store.size).toBe(0);
  });

  it('accepts a card just under 1 MB', async () => {
    const { env } = makeEnv();
    const b = new Uint8Array(1024 * 1024);
    b.set(PNG);
    expect((await post(env, upload(validBody(), b))).status).toBe(201);
  });

  it('turns away an announced body that is far too big before reading it', async () => {
    const { env } = makeEnv();
    const res = await post(env, upload(validBody()), { 'X-App-Secret': SECRET, 'Content-Length': String(5 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('the public routes', () => {
  const get = (env: Env, path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, env, ctx);

  it('serves the page and the card with no secret and no origin', async () => {
    const { env } = makeEnv();
    const id = await publish(env);
    const page = await get(env, `/l/${id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toMatch(/^text\/html/);
    const card = await get(env, `/l/${id}/card.png`);
    expect(card.status).toBe(200);
    expect(card.headers.get('Content-Type')).toBe('image/png');
    expect(card.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await card.arrayBuffer())).toEqual(PNG);
  });

  it('serves them to a browser from any origin too (no origin check)', async () => {
    const { env } = makeEnv();
    const id = await publish(env);
    expect((await get(env, `/l/${id}`, { Origin: 'https://slack.example' })).status).toBe(200);
    expect((await get(env, `/l/${id}/card.png`, { Origin: 'https://evil.test' })).status).toBe(200);
  });

  it('answers HEAD', async () => {
    const { env } = makeEnv();
    const id = await publish(env);
    const res = await app.request(`/l/${id}`, { method: 'HEAD' }, env, ctx);
    expect(res.status).toBe(200);
  });

  it('404s an unknown list without needing the secret', async () => {
    const { env } = makeEnv();
    const page = await get(env, '/l/zzzzzzzzzz');
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('isn’t here');
    expect((await get(env, '/l/zzzzzzzzzz/card.png')).status).toBe(404);
  });

  it('does not reach into the other bucket or other keys through the id', async () => {
    const { env, store } = makeEnv();
    store.set('jobs/x/secret.json', { body: new TextEncoder().encode('{"title":"nope","items":[]}') });
    for (const path of ['/l/..%2Fjobs%2Fx%2Fsecret', '/l/jobs', '/l/%2e%2e']) expect([404, 401]).toContain((await get(env, path)).status);
  });

  it('does not serve a stored object that is not a list', async () => {
    const { env, store } = makeEnv();
    store.set('lists/aaaaaaaaaa.json', { body: new TextEncoder().encode('{"hello":"world"}') });
    expect((await get(env, '/l/aaaaaaaaaa')).status).toBe(404);
    store.set('lists/bbbbbbbbbb.json', { body: new TextEncoder().encode('not json') });
    expect((await get(env, '/l/bbbbbbbbbb')).status).toBe(404);
  });
});

describe('every other route still needs the secret', () => {
  const probes: [string, string][] = [
    ['GET', '/fetch?url=https://example.com'],
    ['GET', '/asset?url=https://example.com/a.png'],
    ['GET', '/archive?source=wayback&url=https://example.com'],
    ['GET', '/ping'],
    ['POST', '/render'],
    ['GET', '/render/0f8fad5b-d9cb-469f-a165-70867728950e'],
    ['DELETE', '/render/0f8fad5b-d9cb-469f-a165-70867728950e'],
    ['POST', '/lists'],
    ['GET', '/lists'],
    ['GET', '/lists/abcdefghij'],
    ['DELETE', '/lists/abcdefghij'],
    // Near misses of the public paths: wrong method, wrong shape, dot segments.
    ['POST', '/l/abcdefghij'],
    ['PUT', '/l/abcdefghij'],
    ['DELETE', '/l/abcdefghij'],
    ['POST', '/l/abcdefghij/card.png'],
    ['GET', '/l'],
    ['GET', '/l/'],
    ['GET', '/l/abcdefghij/'],
    ['GET', '/l/abcdefghij/extra'],
    // The URL parser resolves this to /fetch before the Worker sees it.
    ['GET', '/l/abcdefghij/../../fetch?url=https://example.com'],
    ['GET', '/l/abcdefghij/..%2f..%2ffetch?url=https://example.com'],
    ['GET', '/'],
  ];

  it.each(probes)('%s %s -> 401 without it', async (method, path) => {
    const { env } = makeEnv();
    const res = await app.request(path, { method }, env, ctx);
    expect(res.status).toBe(401);
  });

  it.each(probes)('%s %s -> 403 from a foreign origin', async (method, path) => {
    const { env } = makeEnv();
    const res = await app.request(path, { method, headers: { Origin: 'https://evil.test' } }, env, ctx);
    expect(res.status).toBe(403);
  });
});

describe('the public page', () => {
  const list = (over: Partial<StoredList> = {}): StoredList => ({
    v: 1,
    id: 'abcdefghij',
    createdAt: Date.UTC(2026, 10, 26),
    title: 'Zach’s reading this week',
    range: 'week',
    items: [item(1), item(2, { title: 'Second one', domain: 'vitalik.eth.limo', byline: 'Vitalik Buterin' }), item(3)] as StoredList['items'],
    ...over,
  });
  const opts = { baseUrl: 'https://lists.example', appUrl: 'https://app.example', ctaUrl: 'https://about.example/reader', nonce: 'abc123' };
  const metaOf = (html: string, attr: 'property' | 'name', key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

  it('carries the full Open Graph and Twitter card, with an absolute image url', () => {
    const html = renderListPage(list({ note: 'Good ones.' }), opts);
    expect(metaOf(html, 'property', 'og:title')).toBe('Zach’s reading this week');
    expect(metaOf(html, 'property', 'og:url')).toBe('https://lists.example/l/abcdefghij');
    expect(metaOf(html, 'property', 'og:image')).toBe('https://lists.example/l/abcdefghij/card.png');
    expect(metaOf(html, 'property', 'og:image:width')).toBe('1200');
    expect(metaOf(html, 'property', 'og:image:height')).toBe('630');
    expect(metaOf(html, 'property', 'og:type')).toBe('website');
    expect(metaOf(html, 'property', 'og:site_name')).toBe('Reader');
    expect(metaOf(html, 'property', 'og:description')).toBe('Good ones. — 3 articles: Article 1 · Second one · Article 3');
    expect(metaOf(html, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(metaOf(html, 'name', 'twitter:title')).toBe('Zach’s reading this week');
    expect(metaOf(html, 'name', 'twitter:image')).toBe('https://lists.example/l/abcdefghij/card.png');
    expect(html).toContain('<title>Zach’s reading this week · Reader</title>');
    expect(html).toContain('<link rel="canonical" href="https://lists.example/l/abcdefghij">');
  });

  it('shows the headline, the note, and each item with its links', () => {
    const html = renderListPage(list({ note: 'Good ones.' }), opts);
    expect(html).toContain('<h1>Zach’s reading this week</h1>');
    expect(html).toContain('This week · 3 articles');
    expect(html).toContain('<p class="note">Good ones.</p>');
    expect(html).toContain('href="https://example.com/post-1"');
    expect(html).toContain('vitalik.eth.limo · 8 min · Vitalik Buterin');
    // "Open in Reader" uses the app's #add= entry point, with the article url encoded.
    expect(html).toContain('href="https://app.example/#add=https%3A%2F%2Fexample.com%2Fpost-1"');
    expect(html.match(/Open in Reader<\/a>/g)).toHaveLength(3);
    // The call to action goes where the owner pointed it.
    expect(html).toContain('<a class="btn" href="https://about.example/reader">Get Reader</a>');
    expect(html).toContain('<a class="get" href="https://about.example/reader">Get Reader</a>');
  });

  it('leaves out what it has no target for, and never carries a secret', () => {
    const html = renderListPage(list(), { baseUrl: 'https://lists.example', nonce: 'n' });
    expect(html).not.toContain('Open in Reader');
    expect(html).not.toContain('Get Reader');
    expect(html).not.toMatch(/invite=|APP_SECRET|s3cret/);
  });

  it('refuses a non-http app or cta url in the environment', () => {
    const html = renderListPage(list(), { ...opts, appUrl: 'javascript:alert(1)', ctaUrl: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
  });

  it('escapes every user-supplied string, in text and in attributes', () => {
    const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = renderListPage(
      list({
        title: `Name ${evil}`,
        note: evil,
        items: [{ title: evil, url: `https://example.com/?q=${encodeURIComponent(evil)}&a="b"`, domain: evil, byline: evil, minutes: 3, tint: '#112233' }],
      }),
      opts,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    // Nothing breaks out of an attribute: every `content="` and `href="` value is balanced.
    expect(html.match(/ (content|href|alt|aria-label)="[^"]*"/g)!.every((m) => !m.includes('<'))).toBe(true);
  });

  it('will not link a javascript: or data: url even if one is found in storage', () => {
    const html = renderListPage(list({ items: [{ title: 'Bad', url: 'javascript:alert(1)', domain: 'x.test' }, { title: 'Worse', url: 'data:text/html,hi', domain: 'y.test' }] }), opts);
    expect(html).not.toMatch(/href="(javascript|data):/);
    expect(html).toContain('<span class="title">Bad</span>');
  });

  it('puts tile colors in the stylesheet, not in style attributes, and only valid ones', () => {
    const html = renderListPage(list({ items: [{ title: 'A', url: 'https://a.test/', domain: 'a.test', tint: '#336699' }, { title: 'B', url: 'https://b.test/', domain: 'b.test', tint: 'red;}body{display:none' }] }), opts);
    expect(html).toContain('.t0{background:#336699;color:#f3f2f0}');
    expect(html).not.toContain('display:none');
    expect(html).not.toMatch(/\sstyle="/);
  });

  describe('the player', () => {
    const playLink = (html: string) => html.match(/<a class="play" href="([^"]*)">/)?.[1];
    // Three 8-minute articles in `list()`: the first plays, the whole list is 24 minutes.
    const sized = (mins: number[], over: Partial<StoredList> = {}) => list({ items: mins.map((m, i) => item(i + 1, { minutes: m })) as StoredList['items'], ...over });

    it('shows the first item, its clock, the play button and the total time', () => {
      const html = renderListPage(list({ items: [item(1, { title: 'First one', domain: 'paulgraham.com', minutes: 25 }), item(2, { minutes: 17 }), item(3, { minutes: 95 })] as StoredList['items'] }), opts);
      expect(html).toContain('<section class="player" aria-label="Play Zach’s reading this week">');
      expect(html).toContain('<p class="np-title">First one</p><p class="np-site">paulgraham.com</p>');
      expect(html).toContain('<span>0:00</span><span>25:00</span>');
      expect(html).toContain('<span class="play-label">Listen on Reader</span>');
      expect(html).toContain('<p class="total">3 articles · 2 h 17 m total</p>');
      // It sits between the note and the list.
      expect(html.indexOf('class="player"')).toBeLessThan(html.indexOf('<ol class="list"'));
    });

    it('sends the play button to the first article in Reader, the same #add= link as "Open in Reader"', () => {
      const html = renderListPage(list(), opts);
      expect(playLink(html)).toBe('https://app.example/#add=https%3A%2F%2Fexample.com%2Fpost-1');
      expect(html).toContain('<span class="play-hint">Opens in Reader</span>');
    });

    it('falls back to the Get Reader link when there is no app to open the article in', () => {
      const html = renderListPage(list(), { ...opts, appUrl: undefined });
      expect(playLink(html)).toBe('https://about.example/reader');
      expect(html).toContain('<span class="play-hint">Get Reader to listen</span>');
      // And when the first item has no usable link, even with an app.
      const bad = renderListPage(list({ items: [{ title: 'Bad', url: 'javascript:alert(1)', domain: 'x.test' }, item(2)] as StoredList['items'] }), opts);
      expect(playLink(bad)).toBe('https://about.example/reader');
    });

    it('has no play button at all when it has nowhere honest to send it', () => {
      const html = renderListPage(list(), { baseUrl: 'https://lists.example', nonce: 'n' });
      expect(html).toContain('<section class="player"');
      expect(html).not.toContain('class="play"');
      expect(html).not.toContain('Listen on Reader');
    });

    it('does not pretend to play: no script, audio, button or inline handler anywhere', () => {
      const html = renderListPage(list(), opts);
      expect(html).not.toMatch(/<(script|audio|video|button|source|input)/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toMatch(/href="(#|javascript:)/);
      // The only play control is a link.
      expect(html.match(/class="play"/g)).toHaveLength(1);
    });

    it('adds up only the lengths it knows, and leaves the time out when it knows none', () => {
      expect(renderListPage(sized([10, 20, 30]), opts)).toContain('3 articles · 1 h total');
      expect(renderListPage(sized([10]), opts)).toContain('<p class="total">1 article · 10 m total</p>');
      const unknown = list({ items: [item(1, { minutes: undefined }), item(2, { minutes: undefined })] as StoredList['items'] });
      const html = renderListPage(unknown, opts);
      expect(html).toContain('<p class="total">2 articles</p>');
      expect(html).toContain('<span>0:00</span><span></span>');
    });

    it('colors the first tile through the stylesheet like every other tile', () => {
      const html = renderListPage(list(), opts);
      expect(html).toContain('<span class="tile t0" aria-hidden="true">');
      expect(html).toContain('.t0{background:#2e4057');
      const plain = renderListPage(list({ items: [item(1, { tint: undefined })] as StoredList['items'] }), opts);
      expect(plain).toContain('<span class="tile" aria-hidden="true">');
    });

    it('gives a tile the site\u2019s initials, not its language or www prefix', () => {
      const html = renderListPage(list({ items: [item(1, { domain: 'en.wikipedia.org' }), item(2, { domain: 'www.paulgraham.com' }), item(3, { domain: 'vitalik.eth.limo' })] as StoredList['items'] }), opts);
      expect(html.match(/class="tile[^"]*" aria-hidden="true">([A-Z]+)</g)!.map((m) => m.match(/>([A-Z]+)</)![1])).toEqual(['W', 'W', 'P', 'VE']);
    });

    it('is left out of a list with no items rather than breaking the page', () => {
      expect(renderListPage(list({ items: [] }), opts)).not.toContain('class="player"');
    });
  });

  it('reads as a playlist: an ordered list, numbered by a counter, with each length on its row', () => {
    const html = renderListPage(list(), opts);
    expect(html).toContain('<ol class="list"');
    expect(html).toContain('counter-increment:n');
    expect(html).toContain('content:counter(n)');
    expect(html.match(/<li class="item">/g)).toHaveLength(3);
    expect(html.match(/ · 8 min/g)).toHaveLength(3);
  });

  it('puts a heart in the eyebrow, as on the card', () => {
    const html = renderListPage(list(), opts);
    expect(html).toMatch(/<p class="eyebrow"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20\.1C[^"]*"\/><\/svg>This week · 3 articles<\/p>/);
    expect(html).not.toContain('★');
  });

  it('describes a long list with the first few titles and a count', () => {
    const many = list({ items: Array.from({ length: 12 }, (_, i) => item(i)) as StoredList['items'] });
    expect(describeList(many)).toBe('12 articles: Article 0 · Article 1 · Article 2 and 9 more');
    expect(describeList(list({ items: [item(1)] as StoredList['items'] }))).toBe('1 article: Article 1');
  });

  it('serves it with a strict CSP and no scripts', async () => {
    const { env } = makeEnv({ PUBLIC_CTA_URL: 'https://about.example' });
    const id = await publish(env, validBody({ title: '<b>Title</b>', items: [item(1, { title: '<script>alert(1)</script>' })] }));
    const res = await app.request(`/l/${id}`, {}, env, ctx);
    const html = await res.text();
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src|unsafe-inline|unsafe-eval|\*/);
    expect(csp).toContain("frame-ancestors 'none'");
    // The nonce in the header is the one on the style tag.
    const nonce = csp.match(/style-src 'nonce-([0-9a-f]+)'/)![1];
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=|\sstyle="/i);
    expect(html).toContain('<section class="player"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Title&lt;/b&gt;');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    // The og:image is absolute and on the request's own origin when PUBLIC_BASE_URL is unset.
    expect(html).toContain(`<meta property="og:image" content="http://localhost/l/${id}/card.png">`);
  });

  it('uses a fresh nonce for every response', async () => {
    const { env } = makeEnv();
    const id = await publish(env);
    const nonce = async () => (await app.request(`/l/${id}`, {}, env, ctx)).headers.get('Content-Security-Policy')!.match(/nonce-([0-9a-f]+)/)![1];
    expect(await nonce()).not.toBe(await nonce());
  });
});
