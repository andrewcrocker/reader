import { describe, expect, it } from 'vitest';
import { wrapText } from './card';

// Ten pixels a character keeps the arithmetic obvious: a 100 px line holds ten characters.
const m = (s: string) => s.length * 10;

describe('wrapText', () => {
  it('wraps on spaces', () => {
    expect(wrapText(m, 'one two three four', 100, 5)).toEqual(['one two', 'three four']);
  });

  it('breaks a hyphenated word after its hyphen rather than through it', () => {
    expect(wrapText(m, 'Alexandra Montgomery-Whitfield', 120, 5)).toEqual(['Alexandra', 'Montgomery-', 'Whitfield']);
    // Whole word kept together when it fits.
    expect(wrapText(m, 'a Montgomery-Whitfield', 220, 5)).toEqual(['a Montgomery-Whitfield']);
  });

  it('splits a word wider than the line by characters', () => {
    expect(wrapText(m, 'https://example.com/long', 100, 5)).toEqual(['https://ex', 'ample.com/', 'long']);
  });

  it('ends the last line with an ellipsis, cut at a word', () => {
    expect(wrapText(m, 'the quick brown fox jumps over the lazy dog', 100, 2)).toEqual(['the quick', 'brown fox…']);
    // One word fewer when the ellipsis wouldn't fit after it.
    expect(wrapText(m, 'the quick brown fox jumps', 90, 2)).toEqual(['the quick', 'brown…']);
    expect(wrapText(m, 'short', 100, 1)).toEqual(['short']);
  });

  it('keeps an ellipsis within the width when one long word is all there is', () => {
    const [only] = wrapText(m, 'abcdefghijklmnopqrstuvwxyz', 100, 1);
    expect(only.endsWith('…')).toBe(true);
    expect(m(only)).toBeLessThanOrEqual(100);
  });

  it('returns nothing for empty text', () => {
    expect(wrapText(m, '   ', 100, 2)).toEqual([]);
  });
});
