import { describe, expect, it } from 'vitest';
import { nextSentenceStart, prevSentenceStart, sentenceAt } from './sentences';

const s = [0, 4, 9, 15].map((start, i) => ({ i, text: `s${i}`, start, end: start + 4 }));

describe('sentence navigation', () => {
  it('finds the current sentence', () => {
    expect(sentenceAt(s, 0)).toBe(0);
    expect(sentenceAt(s, 8.9)).toBe(1);
    expect(sentenceAt(s, 100)).toBe(3);
  });
  it('previous restarts the sentence, or steps back near its start', () => {
    expect(prevSentenceStart(s, 12)).toBe(9);
    expect(prevSentenceStart(s, 9.5)).toBe(4);
    expect(prevSentenceStart(s, 0.5)).toBe(0);
  });
  it('next goes to the following start, or nowhere at the end', () => {
    expect(nextSentenceStart(s, 5)).toBe(9);
    expect(nextSentenceStart(s, 16)).toBeUndefined();
  });
});
