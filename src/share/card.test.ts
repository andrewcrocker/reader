import { describe, expect, it } from 'vitest';
import { fmtClock, moreText, playlistSplit, rowsThatFit, subline, widestWord, wrapText, type CardItem, type CardSpec } from './card';

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

  it('keeps a hyphenated word whole when asked not to break it', () => {
    expect(wrapText(m, 'Zach all-time favorites', 100, 5, false)).toEqual(['Zach', 'all-time', 'favorites']);
    expect(wrapText(m, 'Zach all-time favorites', 100, 5)).toEqual(['Zach all-', 'time', 'favorites']);
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

describe('the player', () => {
  const item = (title: string, minutes?: number): CardItem => ({ title, domain: 'example.com', tint: '#336655', minutes });
  const spec = (n: number, total = n): CardSpec => ({ headline: 'h', rangeLabel: 'This week', total, items: Array.from({ length: n }, (_, i) => item(`t${i}`, 10)) });

  it('writes a clock for the first article: elapsed 0:00 of its length', () => {
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(25)).toBe('25:00');
    expect(fmtClock(5)).toBe('5:00');
    expect(fmtClock(75)).toBe('1:15:00');
    expect(fmtClock(1.5)).toBe('1:30');
  });

  it('writes the footer: how many more, or nothing when every article is shown', () => {
    expect(moreText(2)).toBe('+ 2 more');
    expect(moreText(1)).toBe('+ 1 more');
    expect(moreText(0)).toBe('');
  });

  it('writes a row\u2019s second line: the site, then the length when it is known', () => {
    expect(subline(m, 'paulgraham.com', 48, 400)).toBe('paulgraham.com \u00b7 48 min');
    expect(subline(m, 'paulgraham.com', undefined, 400)).toBe('paulgraham.com');
  });

  it('cuts a long site with an ellipsis and keeps the length', () => {
    const line = subline(m, 'a-very-long-subdomain.example.com', 9, 200);
    expect(line.endsWith('\u2026 \u00b7 9 min')).toBe(true);
    expect(m(line)).toBeLessThanOrEqual(200);
    expect(subline(m, 'a-very-long-subdomain.example.com', undefined, 100).endsWith('\u2026')).toBe(true);
  });

  it('shows as many rows as fit, and makes room for "+ N more" when some are left out', () => {
    // Three rows of 60 with 20 between them take 220; the footer is 40 more.
    expect(rowsThatFit([60, 60, 60], 220, 20, 40, 0)).toBe(3);
    // Articles are left out, so the footer needs its room too: only two rows fit.
    expect(rowsThatFit([60, 60, 60], 220, 20, 40, 2)).toBe(2);
    // Taller (wrapped) rows leave fewer.
    expect(rowsThatFit([90, 90, 60], 260, 20, 40, 0)).toBe(2);
    expect(rowsThatFit([90, 90, 60], 130, 20, 40, 0)).toBe(1);
    expect(rowsThatFit([90, 90, 60], 120, 20, 40, 0)).toBe(0);
    expect(rowsThatFit([], 200, 20, 40, 0)).toBe(0);
  });

  it('plays the first article and lists the next few, counting what is left out', () => {
    const six = spec(5, 6);
    expect(playlistSplit(six, 3)).toMatchObject({ now: { title: 't0' }, more: 2 });
    expect(playlistSplit(six, 3).next.map((i) => i.title)).toEqual(['t1', 't2', 't3']);
    // Room for fewer rows means a bigger "more", never a wrong count.
    expect(playlistSplit(six, 1).more).toBe(4);
    expect(playlistSplit(six, 0)).toMatchObject({ next: [], more: 5 });
    // Everything shown: nothing more.
    expect(playlistSplit(spec(3), 5)).toMatchObject({ more: 0 });
    expect(playlistSplit(spec(1), 3)).toMatchObject({ next: [], more: 0 });
    expect(playlistSplit(spec(0, 0), 3)).toMatchObject({ now: undefined, next: [], more: 0 });
  });

  it('measures the widest piece that cannot be broken, so a long name can drop to a size that fits', () => {
    expect(widestWord(m, 'Zach reading this week')).toBe(70);
    expect(widestWord(m, 'a Montgomery-Whitfield')).toBe(m('Montgomery-'));
    expect(widestWord(m, '')).toBe(0);
  });
});
