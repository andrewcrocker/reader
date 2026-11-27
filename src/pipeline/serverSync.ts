import { db, getSettings, type Article } from '../db';
import { deleteJob, fetchChunkBytes, isCacheable, jobStatus, ServerBusyError, ServerUnavailableError, submitJob } from '../tts/server';
import { DEFAULT_VOICE, isVoice } from '../tts/voices';

// The part of server voices that needs no DOM or audio APIs, so the page and the service worker
// (src/sw.ts) share it: sending articles to the Worker, and downloading finished chunks. Locks keep
// the two from sending the same article twice when both are awake.

const POLL_MS = 2000;
const PARALLEL = 4;

/** Rendering can't go on right now (offline, busy, hidden), but the article is fine: try again on the next kick. */
export class ServerWaitError extends Error {}

/** The job failed for good on the server. */
export class ServerJobFailedError extends Error {}

/** Runs `fn` holding a lock shared by every copy of the app and its service worker. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) return navigator.locks.request(name, fn) as Promise<T>;
  return fn();
}

const voiceFor = (a: Article) => (a.voice && isVoice(a.voice) ? a.voice : DEFAULT_VOICE);

/** Chunk indexes the device already has: decoded, or downloaded and waiting to be decoded. */
export async function chunksOnDevice(id: string): Promise<Set<number>> {
  const [rendered, waiting] = await Promise.all([
    db.renderedChunks.where('articleId').equals(id).primaryKeys(),
    db.serverAudio.where('articleId').equals(id).primaryKeys(),
  ]);
  return new Set([...rendered, ...waiting].map(([, i]) => i));
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let onRetry: () => void = () => {};
export function setRetryHandler(fn: () => void) {
  onRetry = fn;
}
function scheduleRetry(at: number) {
  clearTimeout(retryTimer);
  // Timers this long are unreliable in a backgrounded page; the next launch or kick checks too.
  retryTimer = setTimeout(() => onRetry(), Math.min(Math.max(at - Date.now(), 1000), 2 ** 31 - 1));
}

/**
 * Sends every queued article that has text but no job yet (or just `only`). Stops at the first
 * refusal: when the day's budget is spent, every waiting article gets the same `busyUntil`.
 */
export async function submitPending(only?: string[]): Promise<void> {
  await withLock('read-aloud-submit', async () => {
    const now = Date.now();
    // Read inside the lock: another copy may have just sent some of these.
    const all = only ? (await db.articles.bulkGet(only)).filter((a): a is Article => !!a) : await db.articles.toArray();
    const pending = all
      .filter((a) => a.status === 'extracted' && !a.serverJob && !a.archivedAt && !a.deletedAt && !(a.busyUntil && a.busyUntil > now))
      .sort((a, b) => a.queueOrder - b.queueOrder);
    if (!pending.length) return;
    const s = await getSettings();
    if (s.engineKind !== 'server') return;
    for (const a of pending) {
      // Only what's missing: a retry after a failed job keeps the chunks already collected.
      const have = await chunksOnDevice(a.id);
      const missing = (a.chunks ?? []).filter((c) => !have.has(c.i));
      if (!missing.length) continue; // collecting finishes it without a job
      try {
        const job = await submitJob(s, voiceFor(a), missing, isCacheable(a));
        await db.articles.update(a.id, { serverJob: job, busyUntil: undefined });
      } catch (err) {
        if (err instanceof ServerBusyError) {
          await db.articles.where('id').anyOf(pending.map((p) => p.id)).modify((p) => {
            if (!p.serverJob) p.busyUntil = err.retryAt;
          });
          scheduleRetry(err.retryAt);
        }
        return; // unreachable or busy: the rest wait too
      }
    }
  });
}

export interface DownloadOptions {
  isCancelled: () => boolean;
  /** Checked between polls: true stops with a ServerWaitError (page hidden, background time used up). */
  shouldStop: () => boolean;
  /** Stores one downloaded chunk. */
  onChunk: (i: number, mp3: ArrayBuffer) => Promise<void>;
}

/**
 * Downloads an article's finished chunks as the server makes them, until the device has them all.
 * Throws ServerWaitError when it has to stop early and ServerJobFailedError when the job failed.
 */
export async function downloadChunks(a: Article, opts: DownloadOptions): Promise<void> {
  const chunks = a.chunks ?? [];
  const job = a.serverJob;
  if (!job) throw new ServerWaitError('Not sent to the voice server yet');
  const s = await getSettings();
  const have = await chunksOnDevice(a.id);
  let lost = 0;
  while (have.size < chunks.length) {
    if (opts.isCancelled()) return;
    let st;
    try {
      st = await jobStatus(s, job);
    } catch (err) {
      throw new ServerWaitError(err instanceof Error ? err.message : String(err));
    }
    const fresh = st.ready.filter((r) => !have.has(r.i));
    // A few at a time: each is small, and the round trips dominate.
    for (let k = 0; k < fresh.length; k += PARALLEL) {
      if (opts.isCancelled()) return;
      let got: { i: number; mp3: ArrayBuffer }[];
      try {
        got = await Promise.all(fresh.slice(k, k + PARALLEL).map(async (r) => ({ i: r.i, mp3: await fetchChunkBytes(s, job, r.i) })));
      } catch (err) {
        if (err instanceof ServerUnavailableError) throw new ServerWaitError(err.message);
        throw err;
      }
      if (!(await db.articles.get(a.id))) return; // deleted meanwhile
      for (const g of got.sort((x, y) => x.i - y.i)) {
        await opts.onChunk(g.i, g.mp3);
        have.add(g.i);
      }
      await db.articles.update(a.id, { renderProgress: have.size / chunks.length });
    }
    if (have.size >= chunks.length) break;
    if (st.status === 'errored' || st.status === 'terminated') throw new ServerJobFailedError('The voice server couldn’t read this article.');
    if (st.status === 'unknown' && !fresh.length && ++lost > 2) {
      // The job is gone (expired after 7 days, or a local dev server restarted): send the article again.
      await db.articles.update(a.id, { serverJob: undefined, status: 'extracted' });
      throw new ServerWaitError('Voice job lost; resending');
    }
    if (opts.shouldStop()) throw new ServerWaitError('Stopped for now');
    if (!fresh.length) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Every chunk is on the device: the server's copy can go. */
export async function releaseJob(a: Article): Promise<void> {
  if (!a.serverJob) return;
  void deleteJob(await getSettings(), a.serverJob);
  await db.articles.update(a.id, { serverJob: undefined });
}
