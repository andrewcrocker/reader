import type { Chunk, Sentence } from '../db';

/**
 * Sentence start/end times for one rendered chunk, placed at `start` seconds with `dur` seconds of
 * speech. Times inside a multi-sentence chunk are estimated by character share. Mutates `sentences`.
 * Shared by the final file and the stream played while rendering, so both line up.
 */
export function placeChunk(sentences: Sentence[], chunk: Chunk, start: number, dur: number): void {
  const group = sentences.slice(chunk.sentenceStart, chunk.sentenceStart + chunk.sentenceCount);
  const totalChars = group.reduce((n, s) => n + s.text.length, 0) || 1;
  let t = start;
  for (const s of group) {
    const d = (dur * s.text.length) / totalChars;
    s.start = t;
    s.end = t + d;
    t += d;
  }
}
