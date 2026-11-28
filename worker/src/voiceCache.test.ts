import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app, { type Env } from './index';
import { applyReservation, renderChunk, type Lookup, type PartParams, type RenderChunk } from './render';
import { cacheKey, cacheStats, CACHE_TRUST_MS, planRender, splitLookups, VOICE_CACHE_VERSION } from './voiceCache';

// ---- helpers: an in-memory R2 bucket that logs every call, and a quota counter built from the real pieces ----

type Stored = { bytes: Uint8Array; meta: Record<string, string>; uploaded: Date };

function memoryBucket() {
  const store = new Map<string, Stored>();
  const ops: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const toBytes = (v: unknown): Uint8Array =>
    typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? new Uint8Array(v.slice(0)) : new Uint8Array(v as Uint8Array);
  const bucket = {
    put: async (key: string, value: unknown, opts?: { customMetadata?: Record<string, string> }) => {
      ops.push(`put ${key}`);
      store.set(key, { bytes: toBytes(value), meta: { ...opts?.customMetadata }, uploaded: new Date() });
    },
    head: async (key: string) => {
      ops.push(`head ${key}`);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      const o = store.get(key);
      return o ? { key, size: o.bytes.length, customMetadata: o.meta, uploaded: o.uploaded } : null;
    },
    get: async (key: string) => {
      ops.push(`get ${key}`);
      const o = store.get(key);
      if (!o) return null;
      return {
        customMetadata: o.meta,
        body: o.bytes.slice(),
        json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
      };
    },
    list: async ({ prefix }: { prefix: string }) => {
      ops.push(`list ${prefix}`);
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, customMetadata: store.get(key)!.meta })), truncated: false };
    },
    delete: async (keys: string[]) => {
      for (const k of keys) (ops.push(`delete ${k}`), store.delete(k));
    },
  };
  return { bucket, store, ops, peak: () => peak };
}

/** What the Durable Object does, with the real lookups and the real counter rules. */
function memoryQuota(bucket: ReturnType<typeof memoryBucket>['bucket']) {
  let state = { day: '', used: 0, alerted80: false, alerted100: false };
  const calls = { reserve: [] as number[], reserveMisses: 0 };
  const ns = {
    idFromName: () => 'id',
    get: () => ({
      reserve: async (chars: number, cap: number, now: number) => {
        calls.reserve.push(chars);
        const r = applyReservation(state, chars, cap, now);
        state = r.state;
        return r.result;
      },
      reserveMisses: async (voice: string, chunks: RenderChunk[], cap: number, now: number) => {
        calls.reserveMisses++;
        const { lookups, missChars } = await planRender(bucket as never, voice, chunks, now);
        const r = applyReservation(state, missChars, cap, now);
        state = r.state;
        return { ...r.result, lookups };
      },
    }),
  };
  return { ns, calls, get used() { return state.used; } };
}

/** MPEG-2 Layer III frames (24 kHz, 64 kbps, 192 bytes), like the voice host sends, with the Info header frame first. */
function hostMp3(frames = 3): Uint8Array {
  const f = (tag?: string) => {
    const b = new Uint8Array(192);
    b.set([0xff, 0xf3, 0x84, 0xc4]);
    if (tag) b.set([...tag].map((c) => c.charCodeAt(0)), 13);
    return b;
  };
  const all = [f('Info'), ...Array.from({ length: frames }, () => f())];
  const out = new Uint8Array(all.length * 192);
  all.forEach((b, k) => out.set(b, k * 192));
  return out;
}

/** A voice host that records what it was asked to say. */
function stubVoiceHost() {
  const said: { input: string; voice: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).includes('deepinfra')) throw new Error(`unexpected fetch ${url}`);
      said.push(JSON.parse(init.body as string));
      return new Response(hostMp3());
    }),
  );
  return said;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NOW = Date.parse('2026-11-02T12:00:00Z');

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- the key ----

describe('cacheKey', () => {
  it('is sha256 of version, voice and the exact text, in a folder per voice', async () => {
    expect(await cacheKey('af_heart', 'Hello world.')).toBe(`cache/af_heart/${sha(`${VOICE_CACHE_VERSION}\naf_heart\nHello world.`)}.mp3`);
  });
  it('is stable', async () => {
    expect(await cacheKey('af_heart', 'Hello world.')).toBe(await cacheKey('af_heart', 'Hello world.'));
  });
  it('changes with the voice, the text, and the version', async () => {
    const a = await cacheKey('af_heart', 'Hello world.');
    expect(await cacheKey('af_bella', 'Hello world.')).not.toBe(a);
    expect(await cacheKey('af_heart', 'Hello world!')).not.toBe(a);
    expect(await cacheKey('af_heart', 'Hello world. ')).not.toBe(a); // the exact text: no normalizing here
    // Another version is another hash input, so the same text under it is another key.
    expect(sha(`${VOICE_CACHE_VERSION}x\naf_heart\nHello world.`)).not.toBe(sha(`${VOICE_CACHE_VERSION}\naf_heart\nHello world.`));
    expect(VOICE_CACHE_VERSION).toMatch(/^v\d+$/);
  });
});

// ---- looking up ----

describe('planRender', () => {
  const chunks = [
    { i: 0, text: 'First chunk.' },
    { i: 1, text: 'Second chunk here.' },
    { i: 2, text: 'Third.' },
  ];
  const seed = async (store: Map<string, Stored>, voice: string, c: RenderChunk, meta: Record<string, string> = { sec: '2.250' }, uploaded = new Date(NOW)) =>
    void store.set(await cacheKey(voice, c.text), { bytes: new Uint8Array([1, 2, 3, 4]), meta, uploaded });

  it('splits hits from misses, reads the stored length, and counts only misses as characters to pay for', async () => {
    const { bucket, store } = memoryBucket();
    await seed(store, 'af_heart', chunks[0]);
    await seed(store, 'af_heart', chunks[2], { sec: '0.750' });
    const { lookups, missChars } = await planRender(bucket as never, 'af_heart', chunks, NOW);
    expect(lookups).toEqual([
      { i: 0, key: await cacheKey('af_heart', chunks[0].text), sec: 2.25, bytes: 4 },
      { i: 1, key: await cacheKey('af_heart', chunks[1].text) },
      { i: 2, key: await cacheKey('af_heart', chunks[2].text), sec: 0.75, bytes: 4 },
    ]);
    expect(missChars).toBe(chunks[1].text.length);
  });

  it('an all-hit article costs nothing', async () => {
    const { bucket, store } = memoryBucket();
    for (const c of chunks) await seed(store, 'af_heart', c);
    expect((await planRender(bucket as never, 'af_heart', chunks, NOW)).missChars).toBe(0);
  });

  it('another voice is all misses', async () => {
    const { bucket, store } = memoryBucket();
    for (const c of chunks) await seed(store, 'af_bella', c);
    const { lookups, missChars } = await planRender(bucket as never, 'af_heart', chunks, NOW);
    expect(lookups.every((l) => l.sec === undefined)).toBe(true);
    expect(missChars).toBe(chunks.reduce((n, c) => n + c.text.length, 0));
  });

  it('treats an entry with no length, or one past its trusted age, as a miss', async () => {
    const { bucket, store } = memoryBucket();
    await seed(store, 'af_heart', chunks[0], {});
    await seed(store, 'af_heart', chunks[1], { sec: '1.000' }, new Date(NOW - CACHE_TRUST_MS - 1));
    await seed(store, 'af_heart', chunks[2], { sec: '1.000' }, new Date(NOW - CACHE_TRUST_MS + 60_000));
    const { lookups } = await planRender(bucket as never, 'af_heart', chunks, NOW);
    expect(lookups.map((l) => l.sec !== undefined)).toEqual([false, false, true]);
  });

  it('treats a failing lookup as a miss instead of failing the job', async () => {
    const { bucket } = memoryBucket();
    bucket.head = async () => {
      throw new Error('R2 unavailable');
    };
    const { lookups, missChars } = await planRender(bucket as never, 'af_heart', chunks, NOW);
    expect(lookups.map((l) => l.sec)).toEqual([undefined, undefined, undefined]);
    expect(missChars).toBeGreaterThan(0);
  });

  it('keeps lookups to six at a time and returns them in chunk order', async () => {
    const m = memoryBucket();
    const many = Array.from({ length: 40 }, (_, i) => ({ i, text: `Chunk number ${i}.` }));
    const { lookups } = await planRender(m.bucket as never, 'af_heart', many, NOW);
    expect(m.peak()).toBe(6);
    expect(lookups.map((l) => l.i)).toEqual(many.map((c) => c.i));
  });
});

describe('splitLookups and cacheStats', () => {
  const chunks = [{ i: 0, text: 'aaaa' }, { i: 1, text: 'bb' }, { i: 2, text: 'cccccc' }];
  const lookups: Lookup[] = [{ i: 0, key: 'k0', sec: 1.5, bytes: 100 }, { i: 1, key: 'k1' }, { i: 2, key: 'k2', sec: 2, bytes: 300 }];

  it('lists hits for the manifest and gives misses their keys, so the Workflow can store them', () => {
    expect(splitLookups(chunks, lookups)).toEqual({
      hits: [{ i: 0, key: 'k0', sec: 1.5, bytes: 100 }, { i: 2, key: 'k2', sec: 2, bytes: 300 }],
      misses: [{ i: 1, text: 'bb', key: 'k1' }],
    });
  });
  it('counts hits, misses, characters and bytes saved', () => {
    expect(cacheStats(chunks, lookups)).toEqual({ chunks: 3, hits: 2, misses: 1, charsSaved: 10, charsCharged: 2, bytesSaved: 400 });
  });
});

// ---- one chunk, as the Workflow's step runs it ----

describe('renderChunk', () => {
  const job = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const synth = () => vi.fn(async (_env: unknown, _voice: string, _text: string) => ({ mp3: new Uint8Array([9, 9, 9]), sec: 1.5 }));
  const run = (bucket: unknown, chunk: RenderChunk, s = synth()) => renderChunk({ AUDIO: bucket, DEEPINFRA_API_KEY: 'k' } as never, job, 'af_heart', chunk, s);

  it('without a key (every job when the cache is off) writes only jobs/<job>/<i>.mp3', async () => {
    const { bucket, store, ops } = memoryBucket();
    const s = synth();
    expect(await run(bucket, { i: 2, text: 'Say this.' }, s)).toBe(1.5);
    expect(s).toHaveBeenCalledWith(expect.anything(), 'af_heart', 'Say this.');
    expect(ops).toEqual([`put jobs/${job}/2.mp3`]);
    expect(store.get(`jobs/${job}/2.mp3`)).toMatchObject({ bytes: new Uint8Array([9, 9, 9]), meta: { sec: '1.500' } });
  });

  it('with a key, also stores the same bytes and length in the cache', async () => {
    const { bucket, store } = memoryBucket();
    await run(bucket, { i: 0, text: 'Say this.', key: 'cache/af_heart/abc.mp3' });
    expect(store.get('cache/af_heart/abc.mp3')).toMatchObject({ bytes: new Uint8Array([9, 9, 9]), meta: { sec: '1.500' } });
    expect(store.get(`jobs/${job}/0.mp3`)).toMatchObject({ bytes: new Uint8Array([9, 9, 9]), meta: { sec: '1.500' } });
  });

  it('does not cache an empty result, and does not fail over a cache write that fails', async () => {
    const a = memoryBucket();
    await renderChunk({ AUDIO: a.bucket, DEEPINFRA_API_KEY: 'k' } as never, job, 'af_heart', { i: 0, text: 'x', key: 'cache/af_heart/e.mp3' }, async () => ({ mp3: new Uint8Array(), sec: 0 }));
    expect([...a.store.keys()]).toEqual([`jobs/${job}/0.mp3`]);

    const b = memoryBucket();
    const put = b.bucket.put;
    b.bucket.put = async (key: string, ...rest: [unknown, never]) => (key.startsWith('cache/') ? Promise.reject(new Error('429')) : put(key, ...rest));
    await expect(run(b.bucket, { i: 0, text: 'x', key: 'cache/af_heart/f.mp3' })).resolves.toBe(1.5);
    expect(b.store.has(`jobs/${job}/0.mp3`)).toBe(true);
  });
});

// ---- through the real routes ----

const SECRET = 's3cret';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

/** An Env with a memory bucket and quota. `finish` runs the created Workflow parts the way the Workflow would. */
function appEnv(vars: { VOICE_CACHE?: string; DAILY_CHAR_CAP?: string } = {}, shared?: ReturnType<typeof memoryBucket>) {
  const mem = shared ?? memoryBucket();
  const quota = memoryQuota(mem.bucket);
  const parts: { id: string; params: PartParams }[] = [];
  const done = new Set<string>();
  const env = {
    APP_SECRET: SECRET,
    ALLOWED_ORIGINS: '',
    DEEPINFRA_API_KEY: 'k',
    ...vars,
    QUOTA: quota.ns,
    AUDIO: mem.bucket,
    RENDER: {
      create: async (o: { id: string; params: PartParams }) => (parts.push(o), {}),
      get: async (id: string) => ({ status: async () => ({ status: done.has(id) ? 'complete' : 'running' }), terminate: async () => {} }),
    },
  } as unknown as Env;
  const created: PartParams[] = [];
  const finish = async () => {
    for (const part of parts.splice(0)) {
      created.push(part.params);
      for (const chunk of part.params.chunks) await renderChunk(env, part.params.job, part.params.voice, chunk);
      done.add(part.id);
    }
  };
  return { env, ...mem, quota, parts, created, finish };
}
const call = (env: Env, path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { 'X-App-Secret': SECRET, 'Content-Type': 'application/json', ...init.headers } }, env, ctx);
const post = (env: Env, body: unknown) => call(env, '/render', { method: 'POST', body: JSON.stringify(body) });
type Status = { status: string; ready: { i: number; sec: number }[] };
const statusOf = async (env: Env, job: string) => (await (await call(env, `/render/${job}`)).json()) as Status;
const jobOf = async (res: Response) => ((await res.json()) as { job: string }).job;

const article = [
  { i: 0, text: 'Intro to the piece.' },
  { i: 1, text: 'A first paragraph, about ten words long, give or take.' },
  { i: 2, text: 'And a second one.' },
];
const chars = (cs: { text: string }[]) => cs.reduce((n, c) => n + c.text.length, 0);
const cacheObjects = (store: Map<string, Stored>) => [...store.keys()].filter((k) => k.startsWith('cache/'));

describe('/render with the voice cache on', () => {
  it('first add: every chunk is a miss, rendered, charged and cached', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    const said = stubVoiceHost();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    expect(res.status).toBe(202);
    const job = await jobOf(res);
    // Each chunk goes to the Workflow with its cache key; the manifest has no hits.
    expect(t.parts[0].params.chunks.map((c) => c.key)).toEqual(await Promise.all(article.map((c) => cacheKey('af_heart', c.text))));
    expect(JSON.parse(new TextDecoder().decode(t.store.get(`jobs/${job}/job.json`)!.bytes))).toEqual({ parts: 1, chunks: {}, secs: {} });
    expect(t.quota.used).toBe(chars(article));

    await t.finish();
    expect(said.map((s) => s.input).sort()).toEqual(article.map((c) => c.text).sort());
    expect(cacheObjects(t.store).length).toBe(3);
    expect((await statusOf(t.env, job)).status).toBe('complete');
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'voice-cache', job, chunks: 3, hits: 0, misses: 3, charsSaved: 0, charsCharged: chars(article), bytesSaved: 0 }));
  });

  it('second add of the same article: all hits, no Workflow, no voice host, no budget, done at once', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    const said = stubVoiceHost();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await t.finish();
    said.length = 0;
    const used = t.quota.used;

    const res = await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    expect(res.status).toBe(202);
    const job = await jobOf(res);
    expect(t.parts).toEqual([]); // nothing to render
    expect(said).toEqual([]);
    expect(t.quota.used).toBe(used);

    // The app's calls: done straight away, every chunk listed with the stored length, in order.
    const st = await statusOf(t.env, job);
    expect(st.status).toBe('complete');
    expect(st.ready.map((r) => r.i)).toEqual([0, 1, 2]);
    expect(st.ready.every((r) => r.sec > 0)).toBe(true);
    const first = await call(t.env, `/render/${job}/0`);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(first.headers.get('X-Chunk-Seconds')).toBe('0.072'); // the stored length, as the host reported it
    expect(new Uint8Array(await first.arrayBuffer()).length).toBe(3 * 192);
    expect(log).toHaveBeenLastCalledWith(JSON.stringify({ event: 'voice-cache', job, chunks: 3, hits: 3, misses: 0, charsSaved: chars(article), charsCharged: 0, bytesSaved: 3 * 3 * 192 }));
  });

  it('is not "busy" for an article it already has, even when the day\'s budget is spent', async () => {
    const t = appEnv({ VOICE_CACHE: 'on', DAILY_CHAR_CAP: String(chars(article)) });
    stubVoiceHost();
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await t.finish();
    expect(t.quota.used).toBe(chars(article)); // spent to the last character

    expect((await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true })).status).toBe(202);
    // Anything that needs the voice host still says busy.
    expect((await post(t.env, { voice: 'af_heart', chunks: [{ i: 0, text: 'Something new.' }], cacheable: true })).status).toBe(429);
    expect((await post(t.env, { voice: 'af_heart', chunks: article })).status).toBe(429);
  });

  it('a partly cached article renders and pays for the new chunks only, and lists the rest as ready from the start', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    const said = stubVoiceHost();
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await t.finish();
    said.length = 0;
    const before = t.quota.used;

    // The same page after an edit: chunk 1 changed, and a paragraph was added.
    const edited = [article[0], { i: 1, text: 'A revised paragraph.' }, article[2], { i: 3, text: 'A brand new ending.' }];
    const job = await jobOf(await post(t.env, { voice: 'af_heart', chunks: edited, cacheable: true }));
    expect(t.quota.used - before).toBe(chars([edited[1], edited[3]]));
    expect(t.parts.map((p) => p.params.chunks.map((c) => c.i))).toEqual([[1, 3]]);
    const early = await statusOf(t.env, job);
    expect(early.status).toBe('running');
    expect(early.ready.map((r) => r.i)).toEqual([0, 2]);

    await t.finish();
    expect(said.map((s) => s.input).sort()).toEqual(['A brand new ending.', 'A revised paragraph.']);
    const done = await statusOf(t.env, job);
    expect(done.status).toBe('complete');
    expect(done.ready.map((r) => r.i)).toEqual([0, 1, 2, 3]); // in chunk order, hits and new ones together
    expect((await call(t.env, `/render/${job}/1`)).status).toBe(200); // a new one, from the job's folder
    expect((await call(t.env, `/render/${job}/2`)).status).toBe(200); // a hit, from the cache
    expect((await call(t.env, `/render/${job}/9`)).status).toBe(404);
  });

  it('another voice does not reuse the audio', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    const said = stubVoiceHost();
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await t.finish();
    said.length = 0;
    await post(t.env, { voice: 'am_michael', chunks: article, cacheable: true });
    await t.finish();
    expect(said.length).toBe(3);
    expect(cacheObjects(t.store).filter((k) => k.startsWith('cache/am_michael/')).length).toBe(3);
  });

  it('answers busy when the misses do not fit, creating nothing', async () => {
    const t = appEnv({ VOICE_CACHE: 'on', DAILY_CHAR_CAP: String(chars(article) - 1) });
    const res = await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    expect(res.status).toBe(429);
    expect(t.parts).toEqual([]);
    expect([...t.store.keys()]).toEqual([]);
  });

  it('a Workflow step that runs again (a retry or a replay) cannot charge the budget twice', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    stubVoiceHost();
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    const [part] = t.parts;
    const used = t.quota.used;
    for (let attempt = 0; attempt < 3; attempt++) for (const chunk of part.params.chunks) await renderChunk(t.env, part.params.job, part.params.voice, chunk);
    expect(t.quota.used).toBe(used);
    expect(t.quota.calls).toEqual({ reserve: [], reserveMisses: 1 }); // the steps never reach the counter
  });

  it('deleting a job removes its own copies and leaves the cache alone', async () => {
    const t = appEnv({ VOICE_CACHE: 'on' });
    stubVoiceHost();
    await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await t.finish();
    const job1 = [...t.store.keys()].find((k) => k.endsWith('/job.json'))!.split('/')[1];
    const job2 = await jobOf(await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true })); // all hits
    const cached = cacheObjects(t.store);
    t.ops.length = 0;
    expect((await call(t.env, `/render/${job1}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(t.env, `/render/${job2}`, { method: 'DELETE' })).status).toBe(204);
    expect(cacheObjects(t.store)).toEqual(cached);
    expect(t.ops.filter((o) => o.startsWith('delete ')).every((o) => o.includes('jobs/'))).toBe(true);
    expect([...t.store.keys()].filter((k) => k.startsWith('jobs/'))).toEqual([]);
  });

  it('a job made with the cache on still serves its hits if the flag is turned off afterwards', async () => {
    const on = appEnv({ VOICE_CACHE: 'on' });
    stubVoiceHost();
    await post(on.env, { voice: 'af_heart', chunks: article, cacheable: true });
    await on.finish();
    const job = await jobOf(await post(on.env, { voice: 'af_heart', chunks: article, cacheable: true }));
    const off = appEnv({ VOICE_CACHE: 'off' }, on);
    expect((await statusOf(off.env, job)).ready.length).toBe(3);
    expect((await call(off.env, `/render/${job}/1`)).status).toBe(200);
  });

  it('reads the flag as on for on, 1, true and yes only', async () => {
    for (const [value, on] of [['on', true], ['ON', true], ['1', true], ['true', true], ['yes', true], ['off', false], ['0', false], ['', false], ['maybe', false]] as const) {
      const t = appEnv({ VOICE_CACHE: value });
      await post(t.env, { voice: 'af_heart', chunks: article, cacheable: true });
      expect(t.quota.calls.reserveMisses, value).toBe(on ? 1 : 0);
    }
  });
});

describe.each([
  ['the flag is off', { VOICE_CACHE: 'off' }, true],
  ['the flag is unset', {}, true],
  ['the request is not cacheable', { VOICE_CACHE: 'on' }, undefined],
  ['the request says cacheable: false', { VOICE_CACHE: 'on' }, false],
  ['the request says cacheable: "true"', { VOICE_CACHE: 'on' }, 'true'],
])('when %s', (_name, vars, cacheable) => {
  it('behaves as it did before the cache: no cache/ access, the whole article charged, plain manifest and job params', async () => {
    const t = appEnv(vars);
    const said = stubVoiceHost();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Cached audio for these very chunks is sitting there; this job must not see it.
    for (const c of article) t.store.set(await cacheKey('af_heart', c.text), { bytes: new Uint8Array([1]), meta: { sec: '1.000' }, uploaded: new Date() });
    t.ops.length = 0;

    const res = await post(t.env, { voice: 'af_heart', chunks: article, ...(cacheable === undefined ? {} : { cacheable }) });
    expect(res.status).toBe(202);
    const job = await jobOf(res);
    expect(t.parts.map((p) => p.params)).toEqual([{ job, voice: 'af_heart', chunks: article }]);
    expect(new TextDecoder().decode(t.store.get(`jobs/${job}/job.json`)!.bytes)).toBe('{"parts":1}');
    await t.finish();
    expect((await statusOf(t.env, job)).ready.length).toBe(3);
    await call(t.env, `/render/${job}/0`);
    await call(t.env, `/render/${job}/7`);
    await call(t.env, `/render/${job}`, { method: 'DELETE' });

    expect(said.map((s) => s.input).sort()).toEqual(article.map((c) => c.text).sort()); // all synthesized, as given
    expect(t.quota.calls).toEqual({ reserve: [chars(article)], reserveMisses: 0 });
    expect(t.quota.used).toBe(chars(article));
    expect(t.ops.filter((o) => o.includes('cache/'))).toEqual([]);
    expect(t.ops.filter((o) => !o.startsWith('list ')).every((o) => o.includes(`jobs/${job}/`))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});
