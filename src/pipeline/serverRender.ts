import { db, type Article } from '../db';
import { floatToInt16, SAMPLE_RATE } from '../audio/pcm';
import { decodeMp3 } from '../tts/server';
import { finalize } from './render';
import { chunksOnDevice, downloadChunks, releaseJob, ServerWaitError, submitPending } from './serverSync';

// Server voices (plan "Server Kokoro"). Every article with text is sent to the Worker as soon as
// it's ready, so they all render in the background even if the app closes. The service worker
// downloads finished chunks while the app is closed (src/sw.ts); the page decodes them, collects
// the rest, and puts them in renderedChunks, exactly where on-device chunks go, so streaming
// playback, timing and the final file work the same.

export { ServerJobFailedError, ServerWaitError, setRetryHandler, submitPending } from './serverSync';

async function storeDecoded(articleId: string, i: number, mp3: ArrayBuffer): Promise<void> {
  const pcm = await decodeMp3(mp3);
  await db.renderedChunks.put({ articleId, i, pcm: floatToInt16(pcm).buffer as ArrayBuffer, sampleRate: SAMPLE_RATE });
}

/** Decodes chunks the service worker downloaded, in order, so playback can start from them. */
async function decodeWaiting(a: Article, isCancelled: () => boolean): Promise<void> {
  const rows = await db.serverAudio.where('articleId').equals(a.id).sortBy('i');
  const total = a.chunks?.length ?? 0;
  for (const row of rows) {
    if (isCancelled()) return;
    await storeDecoded(a.id, row.i, row.mp3);
    await db.serverAudio.delete([a.id, row.i]);
    const rendered = await db.renderedChunks.where('articleId').equals(a.id).count();
    if (total) await db.articles.update(a.id, { renderProgress: rendered / total });
  }
}

/** Collects one article's finished chunks, then builds its audio file. */
export async function collectArticle(a: Article, isCancelled: () => boolean): Promise<void> {
  const chunks = a.chunks ?? [];
  if (!chunks.length) throw new Error('nothing to render');
  await db.articles.update(a.id, { status: 'rendering', renderProgress: a.renderProgress ?? 0 });
  await decodeWaiting(a, isCancelled);
  if (isCancelled()) return;

  if ((await chunksOnDevice(a.id)).size < chunks.length) {
    if (!a.serverJob) {
      if (a.busyUntil && a.busyUntil > Date.now()) {
        await db.articles.update(a.id, { status: 'extracted' });
        throw new ServerWaitError('Voices are busy');
      }
      await db.articles.update(a.id, { status: 'extracted' });
      await submitPending([a.id]);
      a = (await db.articles.get(a.id)) ?? a;
      if (!a.serverJob) throw new ServerWaitError('Not sent to the voice server yet');
      await db.articles.update(a.id, { status: 'rendering' });
    }
    await downloadChunks(a, {
      isCancelled,
      // Hidden: stop polling; the server keeps going, and the service worker or the next visit collects the rest.
      shouldStop: () => document.visibilityState !== 'visible',
      onChunk: (i, mp3) => storeDecoded(a.id, i, mp3),
    });
    if (isCancelled()) return;
    // The service worker may have saved some while this ran.
    await decodeWaiting(a, isCancelled);
  }

  const fresh = (await db.articles.get(a.id)) ?? a;
  if ((await db.renderedChunks.where('articleId').equals(a.id).count()) < chunks.length) {
    // No job left to collect from: send the missing chunks again on the next kick.
    if (!fresh.serverJob) await db.articles.update(a.id, { status: 'extracted' });
    throw new ServerWaitError('Still collecting');
  }
  await finalize(fresh);
  // A copy the service worker saved while this ran is no longer needed.
  await db.serverAudio.where('articleId').equals(a.id).delete();
  await releaseJob(fresh);
}
