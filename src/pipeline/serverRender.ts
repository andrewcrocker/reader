import { db, getSettings, type Article } from '../db';
import { floatToInt16, SAMPLE_RATE } from '../audio/pcm';
import { deleteJob, fetchChunk, jobStatus, ServerBusyError, ServerUnavailableError, submitJob } from '../tts/server';
import { DEFAULT_VOICE, isVoice } from '../tts/voices';
import { finalize } from './render';

// Server voices (plan "Server Kokoro"). Every article with text is sent to the Worker as soon as
// it's ready, so they all render in the background even if the app closes; the app then collects
// finished chunks into renderedChunks, exactly where on-device chunks go, so streaming playback,
// timing and the final file work the same.

const POLL_MS = 2000;

/** Rendering can't go on right now (offline, busy, hidden), but the article is fine: try again on the next kick. */
export class ServerWaitError extends Error {}

/** The job failed for good on the server. */
export class ServerJobFailedError extends Error {}

const voiceFor = (a: Article) => (a.voice && isVoice(a.voice) ? a.voice : DEFAULT_VOICE);

/**
 * Sends every queued article that has text but no job yet. Stops at the first refusal: when the day's
 * budget is spent, every waiting article gets the same `busyUntil`.
 */
export async function submitPending(articles: Article[]): Promise<void> {
  const now = Date.now();
  const pending = articles.filter((a) => a.status === 'extracted' && !a.serverJob && !a.archivedAt && !a.deletedAt && !(a.busyUntil && a.busyUntil > now));
  if (!pending.length) return;
  const s = await getSettings();
  for (const a of pending) {
    try {
      const job = await submitJob(s, voiceFor(a), a.chunks ?? []);
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

/** Collects one article's finished chunks, then builds its audio file. */
export async function collectArticle(a: Article, isCancelled: () => boolean): Promise<void> {
  const chunks = a.chunks ?? [];
  if (!a.serverJob) {
    if (a.busyUntil && a.busyUntil > Date.now()) throw new ServerWaitError('Voices are busy');
    await submitPending([a]);
    a = (await db.articles.get(a.id)) ?? a;
    if (!a.serverJob) throw new ServerWaitError('Not sent to the voice server yet');
  }
  const job = a.serverJob!;
  const s = await getSettings();
  await db.articles.update(a.id, { status: 'rendering', renderProgress: a.renderProgress ?? 0 });

  const have = new Set((await db.renderedChunks.where('articleId').equals(a.id).primaryKeys()).map(([, i]) => i));
  let lost = 0;
  while (have.size < chunks.length) {
    if (isCancelled()) return;
    let st;
    try {
      st = await jobStatus(s, job);
    } catch (err) {
      throw new ServerWaitError(err instanceof Error ? err.message : String(err));
    }
    const fresh = st.ready.filter((r) => !have.has(r.i));
    for (const r of fresh) {
      if (isCancelled()) return;
      let pcm: Float32Array;
      try {
        pcm = await fetchChunk(s, job, r.i);
      } catch (err) {
        if (err instanceof ServerUnavailableError) throw new ServerWaitError(err.message);
        throw err;
      }
      if (!(await db.articles.get(a.id))) return; // deleted meanwhile
      await db.renderedChunks.put({ articleId: a.id, i: r.i, pcm: floatToInt16(pcm).buffer as ArrayBuffer, sampleRate: SAMPLE_RATE });
      have.add(r.i);
      await db.articles.update(a.id, { renderProgress: have.size / chunks.length });
    }
    if (have.size >= chunks.length) break;
    if (st.status === 'errored' || st.status === 'terminated') throw new ServerJobFailedError('The voice server couldn’t read this article.');
    if (st.status === 'unknown' && !fresh.length && ++lost > 2) {
      // The job is gone (expired after 7 days, or a local dev server restarted): send the article again.
      await db.articles.update(a.id, { serverJob: undefined, status: 'extracted' });
      throw new ServerWaitError('Voice job lost; resending');
    }
    // Hidden: stop polling; the server keeps going and the next visit collects the rest.
    if (document.visibilityState !== 'visible') throw new ServerWaitError('App in background');
    if (!fresh.length) await new Promise((r) => setTimeout(r, POLL_MS));
  }

  await finalize((await db.articles.get(a.id)) ?? a);
  void deleteJob(s, job);
  await db.articles.update(a.id, { serverJob: undefined });
}
