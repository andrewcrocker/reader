import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { type Env } from './index';
import { applyReservation, combineStatus, parseRenderRequest, quotaDay, splitParts, stripHeaderFrames, type Reservation } from './render';

afterEach(() => vi.unstubAllGlobals());

describe('parseRenderRequest', () => {
  const ok = { voice: 'af_heart', chunks: [{ i: 0, text: 'Hello.' }, { i: 1, text: 'World.' }] };
  it('accepts a known voice and chunks', () => {
    expect(parseRenderRequest(ok)).toEqual(ok);
  });
  it.each([
    [{ ...ok, voice: 'bf_emma' }, /unknown voice/],
    [{ ...ok, chunks: [] }, /no chunks/],
    [{ ...ok, chunks: [{ i: 0, text: 'a' }, { i: 0, text: 'b' }] }, /index/],
    [{ ...ok, chunks: [{ i: 0, text: '  ' }] }, /empty/],
    [{ ...ok, chunks: [{ i: 0, text: 'x'.repeat(601) }] }, /too long/],
    [null, /JSON/],
  ])('rejects %#', (body, msg) => {
    expect(parseRenderRequest(body)).toMatch(msg);
  });
});

describe('applyReservation', () => {
  const day = (iso: string) => Date.parse(iso);
  const fresh = { day: '', used: 0, alerted80: false, alerted100: false };

  it('counts per UTC day, alerts once at 80% and once when refused', () => {
    const t = day('2026-10-28T12:00:00Z');
    let s = fresh;
    const step = (chars: number, now = t) => {
      const r = applyReservation(s, chars, 100, now);
      s = r.state;
      return r.result;
    };
    expect(step(70)).toMatchObject({ ok: true, used: 70, alert: undefined });
    expect(step(15)).toMatchObject({ ok: true, used: 85, alert: 80 });
    expect(step(5)).toMatchObject({ ok: true, used: 90, alert: undefined });
    expect(step(20)).toMatchObject({ ok: false, used: 90, alert: 100, retryAt: day('2026-10-29T00:00:00Z') });
    expect(step(20)).toMatchObject({ ok: false, alert: undefined });
    // Next day starts over.
    expect(step(20, day('2026-10-29T00:00:01Z'))).toMatchObject({ ok: true, used: 20, alert: undefined });
  });

  it('names the day in UTC', () => {
    expect(quotaDay(day('2026-10-28T23:59:59Z')).day).toBe('2026-10-28');
  });
});

/** An MPEG-2 Layer III frame (24 kHz, 64 kbps, 192 bytes), optionally carrying a header tag. */
function frame(tag?: string): Uint8Array {
  const f = new Uint8Array(192);
  f.set([0xff, 0xf3, 0x84, 0xc4]); // sync, MPEG2 L3 no CRC; bitrate idx 8 (64), 24 kHz; mono
  if (tag) f.set([...tag].map((c) => c.charCodeAt(0)), 13);
  return f;
}
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

describe('stripHeaderFrames', () => {
  it('drops ID3 and the Xing/Info frame, and times the rest', () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0]);
    const { mp3, sec } = stripHeaderFrames(join(id3, frame('Info'), frame(), frame(), frame()));
    expect(mp3.length).toBe(3 * 192);
    expect(sec).toBeCloseTo((3 * 576) / 24000);
  });
});

describe('splitParts and combineStatus', () => {
  it('keeps each Workflow run under the free plan request limit', () => {
    expect(splitParts(Array.from({ length: 89 }, (_, i) => i)).map((p) => p.length)).toEqual([30, 30, 29]);
  });
  it('combines part statuses', () => {
    expect(combineStatus(['complete', 'complete'])).toBe('complete');
    expect(combineStatus(['complete', 'running'])).toBe('running');
    expect(combineStatus(['complete', 'errored', 'running'])).toBe('errored');
    expect(combineStatus(['unknown', 'unknown'])).toBe('unknown');
    expect(combineStatus(['complete', 'unknown'])).toBe('running');
  });
});

function fakeEnv(reservation: Partial<Reservation> = {}) {
  const objects = new Map<string, { body: Uint8Array; sec: string }>();
  const manifests = new Map<string, string>();
  const created: unknown[] = [];
  const env = {
    APP_SECRET: 's3cret',
    ALLOWED_ORIGINS: '',
    DEEPINFRA_API_KEY: 'k',
    QUOTA: {
      idFromName: () => 'id',
      get: () => ({ reserve: async (chars: number) => ({ ok: true, used: chars, cap: 330000, retryAt: 0, ...reservation }) }),
    },
    RENDER: {
      create: async (o: unknown) => (created.push(o), {}),
      get: async () => ({ status: async () => ({ status: 'running' }), terminate: async () => {} }),
    },
    AUDIO: {
      put: async (key: string, value: string) => void manifests.set(key, value),
      list: async ({ prefix }: { prefix: string }) => ({
        objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, customMetadata: { sec: objects.get(key)!.sec } })),
        truncated: false,
      }),
      get: async (key: string) =>
        manifests.has(key)
          ? { json: async () => JSON.parse(manifests.get(key)!) }
          : objects.has(key)
            ? { body: objects.get(key)!.body, customMetadata: { sec: objects.get(key)!.sec } }
            : null,
      delete: async (keys: string[]) => keys.forEach((k) => objects.delete(k)),
    },
  } as unknown as Env;
  return { env, objects, created, manifests };
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
const call = (env: Env, path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { 'X-App-Secret': 's3cret', 'Content-Type': 'application/json', ...init.headers } }, env, ctx);

describe('/render', () => {
  const body = JSON.stringify({ voice: 'af_bella', chunks: [{ i: 0, text: 'Hello there.' }] });

  it('starts a job', async () => {
    const { env, created } = fakeEnv();
    const res = await call(env, '/render', { method: 'POST', body });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: string };
    expect(created).toEqual([{ id: `${job}-p0`, params: { job, voice: 'af_bella', chunks: [{ i: 0, text: 'Hello there.' }] } }]);
  });

  it('splits a long article into parts', async () => {
    const { env, created } = fakeEnv();
    const chunks = Array.from({ length: 65 }, (_, i) => ({ i, text: `Sentence ${i}.` }));
    const res = await call(env, '/render', { method: 'POST', body: JSON.stringify({ voice: 'af_heart', chunks }) });
    const { job } = (await res.json()) as { job: string };
    expect((created as { id: string; params: { chunks: unknown[] } }[]).map((c) => [c.id, c.params.chunks.length])).toEqual([
      [`${job}-p0`, 30],
      [`${job}-p1`, 30],
      [`${job}-p2`, 5],
    ]);
  });

  it('answers busy with the reset time when the budget is spent', async () => {
    const { env, created } = fakeEnv({ ok: false, retryAt: 123 });
    const res = await call(env, '/render', { method: 'POST', body });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'busy', retryAt: 123 });
    expect(created).toEqual([]);
  });

  it('lists ready chunks, serves them, and deletes them', async () => {
    const { env, objects, manifests } = fakeEnv();
    const job = '0f8fad5b-d9cb-469f-a165-70867728950e';
    manifests.set(`jobs/${job}/job.json`, JSON.stringify({ parts: 1 }));
    objects.set(`jobs/${job}/1.mp3`, { body: new Uint8Array([2]), sec: '2.5' });
    objects.set(`jobs/${job}/0.mp3`, { body: new Uint8Array([1]), sec: '1.25' });
    const status = await (await call(env, `/render/${job}`)).json();
    expect(status).toEqual({ status: 'running', ready: [{ i: 0, sec: 1.25 }, { i: 1, sec: 2.5 }] });

    const chunk = await call(env, `/render/${job}/1`);
    expect(chunk.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await chunk.arrayBuffer())).toEqual(new Uint8Array([2]));
    expect((await call(env, `/render/${job}/7`)).status).toBe(404);

    expect((await call(env, `/render/${job}`, { method: 'DELETE' })).status).toBe(204);
    expect(objects.size).toBe(0);
  });

  it('needs the app secret', async () => {
    const { env } = fakeEnv();
    expect((await app.request('/render', { method: 'POST', body }, env, ctx)).status).toBe(401);
  });
});
