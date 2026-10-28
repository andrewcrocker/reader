import { db, type Article } from '../db';
import { floatToInt16, silence, SAMPLE_RATE, wavBlob } from '../audio/pcm';
import { encodeMp3 } from '../audio/encode';
import { saveAudio } from '../audio/storage';
import type { KokoroEngine } from '../tts/engine';

/**
 * Renders any chunks not yet saved, then concatenates everything into one audio file
 * and writes sentence timings. Safe to call again after an interruption.
 */
export async function renderArticle(article: Article, engine: KokoroEngine, isCancelled: () => boolean): Promise<void> {
  const chunks = article.chunks ?? [];
  if (!chunks.length) throw new Error('nothing to render');
  const voice = article.voice!;

  const done = new Set(
    (await db.renderedChunks.where('articleId').equals(article.id).primaryKeys()).map(([, i]) => i),
  );

  for (const chunk of chunks) {
    if (done.has(chunk.i)) continue;
    if (isCancelled()) return;
    const { pcm, sampleRate } = await engine.synthesize(chunk.text, voice);
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
    // Sentence times inside a multi-sentence chunk are estimated by character share.
    const group = sentences.slice(chunk.sentenceStart, chunk.sentenceStart + chunk.sentenceCount);
    const totalChars = group.reduce((n, s) => n + s.text.length, 0) || 1;
    let st = t;
    for (const s of group) {
      const d = (dur * s.text.length) / totalChars;
      s.start = st;
      s.end = st + d;
      st += d;
    }
    parts.push(pcm, silence(chunk.pauseAfter, sampleRate));
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
