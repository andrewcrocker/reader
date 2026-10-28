import type { Chunk, Settings } from '../db';
import { SAMPLE_RATE } from '../audio/pcm';
import { noteInviteRejected } from '../app/invite';

// Server voices: the Worker renders an article's chunks in the background (plan "Server Kokoro";
// worker/src/render.ts). The app sends the text once, then collects finished chunks whenever it's open.

/** The day's voice budget is spent; try again after `retryAt` (ms since epoch). */
export class ServerBusyError extends Error {
  constructor(readonly retryAt: number) {
    super('Voices are busy right now');
  }
}

/** Couldn't reach the Worker, or it answered with an error that a later try might not hit. */
export class ServerUnavailableError extends Error {}

export type JobStatus = { status: string; ready: { i: number; sec: number }[] };

const base = (s: Settings) => `${s.proxyUrl.replace(/\/$/, '')}/render`;
const auth = (s: Settings) => ({ 'X-App-Secret': s.proxySecret });

async function call(input: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new ServerUnavailableError('Couldn’t reach the voice server');
  }
  if (res.status === 401) {
    noteInviteRejected();
    throw new ServerUnavailableError('The voice server rejected this invite');
  }
  return res;
}

/** Starts a server render; returns the job id. */
export async function submitJob(s: Settings, voice: string, chunks: Chunk[]): Promise<string> {
  const res = await call(base(s), {
    method: 'POST',
    headers: { ...auth(s), 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice, chunks: chunks.map((c) => ({ i: c.i, text: c.text })) }),
  });
  const body = (await res.json().catch(() => ({}))) as { job?: string; error?: string; retryAt?: number };
  if (res.status === 429) throw new ServerBusyError(body.retryAt ?? Date.now() + 3_600_000);
  if (!res.ok || !body.job) {
    // 400 means the request itself is wrong (a bug), so retrying won't help; anything else might pass later.
    if (res.status === 400) throw new Error(`Voice server refused the article: ${body.error ?? res.status}`);
    throw new ServerUnavailableError(`Voice server error (${res.status})`);
  }
  return body.job;
}

export async function jobStatus(s: Settings, job: string): Promise<JobStatus> {
  const res = await call(`${base(s)}/${job}`, { headers: auth(s), cache: 'no-store' });
  if (!res.ok) throw new ServerUnavailableError(`Voice server error (${res.status})`);
  return (await res.json()) as JobStatus;
}

/** One finished chunk, decoded to mono PCM at the app's sample rate. */
export async function fetchChunk(s: Settings, job: string, i: number): Promise<Float32Array> {
  const res = await call(`${base(s)}/${job}/${i}`, { headers: auth(s), cache: 'no-store' });
  if (!res.ok) throw new ServerUnavailableError(`Voice server error (${res.status})`);
  return decodeMp3(await res.arrayBuffer());
}

/** Frees the server's copy once the app has every chunk. Best effort: R2 expires leftovers after 7 days. */
export async function deleteJob(s: Settings, job: string): Promise<void> {
  await fetch(`${base(s)}/${job}`, { method: 'DELETE', headers: auth(s) }).catch(() => {});
}

let decoder: OfflineAudioContext | null = null;

/** Decodes (and if needed resamples) to the app's sample rate, so chunks join like on-device ones. */
export async function decodeMp3(bytes: ArrayBuffer): Promise<Float32Array> {
  decoder ??= new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buf = await decoder.decodeAudioData(bytes);
  return buf.getChannelData(0).slice();
}
