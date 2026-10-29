import type { Sentence } from '../db';

/** Index of the sentence playing at `t` (the last one that started at or before it). */
export function sentenceAt(sentences: Sentence[], t: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // Sentences not timed yet (still rendering) sort after everything that is.
    const start = sentences[mid].start ?? Infinity;

    if (start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Where "previous sentence" goes: the start of the current sentence, or the one before it if we're
 * within the first 1.5 s (like a music player's previous track).
 */
export function prevSentenceStart(sentences: Sentence[], t: number): number {
  const i = sentenceAt(sentences, t);
  const start = sentences[i]?.start ?? 0;
  if (t - start > 1.5 || i === 0) return start;
  return sentences[i - 1].start ?? 0;
}

export function nextSentenceStart(sentences: Sentence[], t: number): number | undefined {
  const i = sentenceAt(sentences, t);
  return sentences[i + 1]?.start;
}
