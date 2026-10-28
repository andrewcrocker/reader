import type { Hono } from 'hono';

// Server voices (plan: "Server Kokoro"). The app sends an article's chunks once; a Workflow renders
// them through the voice host and keeps each chunk's MP3 in R2 until the app downloads it, so the
// phone can sleep or close the app meanwhile.

/** Same list as the app's src/tts/voices.ts. */
export const VOICES = ['af_heart', 'af_bella', 'am_michael'] as const;

export const MAX_CHUNKS = 400;
export const MAX_CHUNK_CHARS = 600;
export const MAX_ARTICLE_CHARS = 120_000;
/** About 33 ten-minute articles a day, which keeps a month under $10 at $0.99 per million characters. */
export const DEFAULT_DAILY_CHAR_CAP = 330_000;

export type RenderEnv = {
  AUDIO: R2Bucket;
  RENDER: Workflow<RenderParams>;
  QUOTA: DurableObjectNamespace<QuotaApi & Rpc.DurableObjectBranded>;
  DEEPINFRA_API_KEY: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL?: string;
  DAILY_CHAR_CAP?: string;
};

export type RenderChunk = { i: number; text: string };
export type RenderParams = { voice: string; chunks: RenderChunk[] };

/** What the quota counter answers for a reservation. */
export type Reservation = { ok: boolean; used: number; cap: number; alert?: 80 | 100; retryAt: number };
export interface QuotaApi {
  reserve(chars: number, cap: number, now: number): Promise<Reservation>;
}

/** Returns the parsed request, or an error message. */
export function parseRenderRequest(body: unknown): RenderParams | string {
  if (!body || typeof body !== 'object') return 'expected a JSON body';
  const { voice, chunks } = body as Partial<RenderParams>;
  if (typeof voice !== 'string' || !(VOICES as readonly string[]).includes(voice)) return `unknown voice: ${String(voice)}`;
  if (!Array.isArray(chunks) || !chunks.length) return 'no chunks';
  if (chunks.length > MAX_CHUNKS) return 'too many chunks';
  let total = 0;
  const seen = new Set<number>();
  for (const c of chunks) {
    if (!c || !Number.isInteger(c.i) || c.i < 0 || seen.has(c.i)) return 'bad chunk index';
    if (typeof c.text !== 'string' || !c.text.trim()) return `empty chunk ${c.i}`;
    if (c.text.length > MAX_CHUNK_CHARS) return `chunk ${c.i} too long`;
    seen.add(c.i);
    total += c.text.length;
  }
  if (total > MAX_ARTICLE_CHARS) return 'article too long';
  return { voice, chunks: chunks.map((c) => ({ i: c.i, text: c.text })) };
}

export const charCount = (p: RenderParams) => p.chunks.reduce((n, c) => n + c.text.length, 0);

/** UTC day the quota counts against, and when it resets. */
export function quotaDay(now: number): { day: string; resetsAt: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { day: new Date(start).toISOString().slice(0, 10), resetsAt: start + 86_400_000 };
}

/** The counter's rule, kept pure so it's testable: reserve if it fits, alert once at 80% and once when refused. */
export function applyReservation(
  state: { day: string; used: number; alerted80: boolean; alerted100: boolean },
  chars: number,
  cap: number,
  now: number,
): { state: typeof state; result: Reservation } {
  const { day, resetsAt } = quotaDay(now);
  const s = state.day === day ? { ...state } : { day, used: 0, alerted80: false, alerted100: false };
  if (s.used + chars > cap) {
    const alert = s.alerted100 ? undefined : (100 as const);
    s.alerted100 = true;
    return { state: s, result: { ok: false, used: s.used, cap, alert, retryAt: resetsAt } };
  }
  s.used += chars;
  let alert: 80 | undefined;
  if (!s.alerted80 && s.used >= cap * 0.8) {
    s.alerted80 = true;
    alert = 80;
  }
  return { state: s, result: { ok: true, used: s.used, cap, alert, retryAt: resetsAt } };
}

const chunkKey = (job: string, i: number) => `jobs/${job}/${i}.mp3`;
const JOB_ID = /^[0-9a-f-]{36}$/;

export function registerRenderRoutes<E extends RenderEnv>(app: Hono<{ Bindings: E }>) {
  /** POST /render {voice, chunks:[{i,text}]} → 202 {job}, or 429 {error:'busy', retryAt} when the day's budget is spent. */
  app.post('/render', async (c) => {
    const parsed = parseRenderRequest(await c.req.json().catch(() => null));
    if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
    if (!c.env.DEEPINFRA_API_KEY) return c.json({ error: 'voices misconfigured: DEEPINFRA_API_KEY unset' }, 500);

    const cap = Number(c.env.DAILY_CHAR_CAP) || DEFAULT_DAILY_CHAR_CAP;
    const quota = c.env.QUOTA.get(c.env.QUOTA.idFromName('global'));
    const r = await quota.reserve(charCount(parsed), cap, Date.now());
    if (r.alert) c.executionCtx.waitUntil(sendCapAlert(c.env, r));
    if (!r.ok) return c.json({ error: 'busy', retryAt: r.retryAt }, 429);

    const job = crypto.randomUUID();
    await c.env.RENDER.create({ id: job, params: parsed });
    return c.json({ job, chunks: parsed.chunks.length }, 202);
  });

  /** GET /render/:job → {status, ready:[{i, sec}]}; `ready` lists chunks the app can download now. */
  app.get('/render/:job', async (c) => {
    const job = c.req.param('job');
    if (!JOB_ID.test(job)) return c.json({ error: 'bad job id' }, 400);
    let status: string;
    try {
      status = (await (await c.env.RENDER.get(job)).status()).status;
    } catch {
      status = 'unknown'; // finished and cleaned up, or never existed; `ready` still says what's there
    }
    const ready: { i: number; sec: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.env.AUDIO.list({ prefix: `jobs/${job}/`, cursor, include: ['customMetadata'] });
      for (const o of page.objects) {
        const i = Number(o.key.slice(o.key.lastIndexOf('/') + 1, -'.mp3'.length));
        ready.push({ i, sec: Number(o.customMetadata?.sec ?? 0) });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    ready.sort((a, b) => a.i - b.i);
    return c.json({ status, ready }, 200, { 'Cache-Control': 'no-store' });
  });

  /** GET /render/:job/:i → that chunk's MP3. */
  app.get('/render/:job/:i', async (c) => {
    const job = c.req.param('job');
    const i = Number(c.req.param('i'));
    if (!JOB_ID.test(job) || !Number.isInteger(i)) return c.json({ error: 'bad request' }, 400);
    const obj = await c.env.AUDIO.get(chunkKey(job, i));
    if (!obj) return c.json({ error: 'not ready' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Chunk-Seconds': obj.customMetadata?.sec ?? '',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-store',
      },
    });
  });

  /** DELETE /render/:job → drop the server's copy once the app has it (a 7-day R2 rule catches the rest). */
  app.delete('/render/:job', async (c) => {
    const job = c.req.param('job');
    if (!JOB_ID.test(job)) return c.json({ error: 'bad job id' }, 400);
    let cursor: string | undefined;
    do {
      const page = await c.env.AUDIO.list({ prefix: `jobs/${job}/`, cursor });
      if (page.objects.length) await c.env.AUDIO.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    try {
      await (await c.env.RENDER.get(job)).terminate();
    } catch {
      /* already finished */
    }
    return c.body(null, 204);
  });
}

/** One chunk through the voice host. Returns MP3 bytes with the per-file header frame removed. */
export async function synthesizeChunk(env: Pick<RenderEnv, 'DEEPINFRA_API_KEY'>, voice: string, text: string): Promise<{ mp3: Uint8Array; sec: number }> {
  const res = await fetch('https://api.deepinfra.com/v1/openai/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DEEPINFRA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'hexgrad/Kokoro-82M', input: text, voice, response_format: 'mp3' }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new VoiceHostError(res.status, (await res.text()).slice(0, 200));
  return stripHeaderFrames(new Uint8Array(await res.arrayBuffer()));
}

export class VoiceHostError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`voice host HTTP ${status}: ${body}`);
  }
  /** 4xx other than rate limits won't get better on retry. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

const BITRATES: Record<number, number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const TAGS = ['Xing', 'Info', 'VBRI'].map((t) => [...t].map((ch) => ch.charCodeAt(0)));

/**
 * Drops ID3 tags and the Xing/Info header frame each encoded file starts with, so chunks can be
 * joined and players see the real length; returns the audio's duration from the frame count.
 * Layer III only, which is all the voice host sends.
 */
export function stripHeaderFrames(b: Uint8Array): { mp3: Uint8Array; sec: number } {
  const keep: Uint8Array[] = [];
  let sec = 0;
  let i = 0;
  while (i + 4 <= b.length) {
    if (b[i] === 0x49 && b[i + 1] === 0x44 && b[i + 2] === 0x33 && i + 10 <= b.length) {
      const size = ((b[i + 6] & 127) << 21) | ((b[i + 7] & 127) << 14) | ((b[i + 8] & 127) << 7) | (b[i + 9] & 127);
      i += 10 + size;
      continue;
    }
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (b[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const kbps = BITRATES[version === 3 ? 1 : 2][b[i + 2] >> 4];
    const rate = SAMPLE_RATES[version]?.[(b[i + 2] >> 2) & 3];
    if (!kbps || !rate) {
      i++;
      continue;
    }
    const samples = version === 3 ? 1152 : 576;
    const len = Math.floor(((samples / 8) * kbps * 1000) / rate) + ((b[i + 2] >> 1) & 1);
    const frame = b.subarray(i, Math.min(i + len, b.length));
    if (!hasTag(frame)) {
      keep.push(frame);
      sec += samples / rate;
    }
    i += len;
  }
  const out = new Uint8Array(keep.reduce((n, f) => n + f.length, 0));
  let o = 0;
  for (const f of keep) {
    out.set(f, o);
    o += f.length;
  }
  return { mp3: out, sec };
}

function hasTag(frame: Uint8Array): boolean {
  // The tag sits right after the side info, within the first ~40 bytes.
  const end = Math.min(frame.length - 4, 48);
  for (let j = 4; j <= end; j++) {
    if (TAGS.some((t) => t.every((ch, k) => frame[j + k] === ch))) return true;
  }
  return false;
}

/** Email the owner when the daily voice budget hits 80% or runs out (Resend; sends only to its account address). */
export async function sendCapAlert(env: Pick<RenderEnv, 'RESEND_API_KEY' | 'ALERT_EMAIL'>, r: Reservation): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  const pct = r.alert === 100 ? 'used up' : '80% used';
  const resets = new Date(r.retryAt).toUTCString();
  const text =
    r.alert === 100
      ? `Read-Aloud refused a voice request: today's budget of ${r.cap.toLocaleString('en-US')} characters is used up. Articles wait and finish after the reset (${resets}).`
      : `Read-Aloud has used ${r.used.toLocaleString('en-US')} of today's ${r.cap.toLocaleString('en-US')} voice characters. It resets ${resets}.`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Read-Aloud <onboarding@resend.dev>', to: [env.ALERT_EMAIL], subject: `Read-Aloud: voice budget ${pct}`, text }),
  }).catch(() => {});
}
