import { db, type Article } from '../db';
import { floatToInt16, silence, SAMPLE_RATE, wavBlob } from '../audio/pcm';
import { encodeMp3 } from '../audio/encode';
import { saveAudio } from '../audio/storage';
import type { KokoroEngine } from '../tts/engine';
import { placeChunk } from './timeline';

/**
 * Renders any chunks not yet saved, then concatenates everything into one audio file
 * and writes sentence timings. Safe to call again after an interruption.
 */
/** `getEngine` is asked before every chunk, so the engine can be swapped mid-article (e.g. back onto the GPU). */
export async function renderArticle(article: Article, getEngine: () => Promise<KokoroEngine>, isCancelled: () => boolean): Promise<void> {
  const chunks = article.chunks ?? [];
  if (!chunks.length) throw new Error('nothing to render');
  const voice = article.voice!;

  const done = new Set(
    (await db.renderedChunks.where('articleId').equals(article.id).primaryKeys()).map(([, i]) => i),
  );

  for (const chunk of chunks) {
    if (done.has(chunk.i)) continue;
    if (isCancelled()) return;
    const engine = await getEngine();
    if (isCancelled()) return;
    const { pcm, sampleRate, ms } = await engine.synthesize(chunk.text, voice);
    const sec = pcm.length / sampleRate;
    console.debug(`chunk ${chunk.i + 1}/${chunks.length}: ${sec.toFixed(1)} s of audio in ${(ms / 1000).toFixed(1)} s (${(sec / (ms / 1000)).toFixed(2)}× real time)`);
    if (!(await db.articles.get(article.id))) return; // deleted mid-render
    const int16 = floatToInt16(pcm);
    await db.renderedChunks.put({ articleId: article.id, i: chunk.i, pcm: int16.buffer as ArrayBuffer, sampleRate });
    done.add(chunk.i);
    await db.articles.update(article.id, { renderProgress: done.size / chunks.length });
  }

  await finalize(article);
}

async function finalize(article: Article): Promise<void> {
  const chunks = article.chunks!;
  const rows = await db.renderedChunks.where('articleId').equals(article.id).sortBy('i');
  if (rows.length !== chunks.length) throw new Error(`expected ${chunks.length} chunks, found ${rows.length}`);

  const sampleRate = rows[0]?.sampleRate ?? SAMPLE_RATE;
  const parts: Int16Array[] = [];
  const sentences = article.sentences.map((s) => ({ ...s }));
  let t = 0;

  for (const chunk of chunks) {
    const pcm = new Int16Array(rows[chunk.i].pcm);
    const dur = pcm.length / sampleRate;
    placeChunk(sentences, chunk, t, dur);
    parts.push
(pcm, silence(chunk.pauseAfter, sampleRate));
    t += dur + chunk.pauseAfter;
  }

  let blob: Blob;
  let ext = 'mp3';
  try {
    blob = await encodeMp3(parts, sampleRate);
  } catch (err) {
    console.warn('MP3 encode failed, storing WAV', err);
    blob = wavBlob(parts, sampleRate);
    ext = 'wav';
  }
  const audioKey = await saveAudio(article.id, blob, ext);

  await db.transaction('rw', db.articles, db.renderedChunks, async () => {
    if (!(await db.articles.get(article.id))) return;
    await db.articles.update(article.id, {
      status: 'ready',
      sentences,
      audioKey,
      audioMime: blob.type,
      audioBytes: blob.size,
      durationSec: t,
      renderProgress: 1,
      error: undefined,
    });
    await db.renderedChunks.where('articleId').equals(article.id).delete();
  });
}
