import { afterAll, describe, expect, it } from 'vitest';
import type { Article } from '../db';
import { cardFileName, headline, lovedArticles, listArticles, listSignature, nextWeekStart, possessive, rangeCounts, toShareItem, weekStart } from './lists';

// "This week" is the calendar week in local time, so these tests pin the time zone: Pacific, where daylight
// saving ended on Sunday 1 Nov 2026 (a 25-hour day) and began on Sunday 8 Mar 2026 (a 23-hour one).
const TZ_BEFORE = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
afterAll(() => {
  if (TZ_BEFORE === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_BEFORE;
});

/** A local date and time. Months are 1-12, so the test reads like the calendar. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Thursday 26 Nov 2026, noon. Its week runs Monday 23 Nov 00:00 to Sunday 29 Nov 23:59. */
const NOW = at(2026, 11, 26, 12);
const art = (id: string, over: Partial<Article> = {}): Article => ({
  id,
  source: 'url',
  url: `https://example.com/${id}`,
  title: `Title ${id}`,
  domain: 'example.com',
  savedAt: 1,
  status: 'ready',
  sentences: [],
  positionSec: 0,
  queueOrder: 1,
  ...over,
});

describe('the calendar week', () => {
  it('runs on the pinned time zone', () => {
    // If this fails the machine ignored TZ, and the DST cases below would pass or fail by accident.
    expect(new Date(2026, 9, 26).getTimezoneOffset()).toBe(420);
    expect(new Date(2026, 10, 2).getTimezoneOffset()).toBe(480);
  });

  it('starts on Monday at 00:00 local, whatever day of the week it is now', () => {
    const monday = at(2026, 11, 23);
    expect(weekStart(monday)).toBe(monday);
    expect(weekStart(NOW)).toBe(monday);
    expect(weekStart(at(2026, 11, 28, 9))).toBe(monday); // Saturday
    expect(weekStart(at(2026, 11, 29, 23, 59, 59, 999))).toBe(monday); // the last millisecond of Sunday
  });

  it('ends at the next Monday 00:00: Sunday 23:59 is this week, a minute later is the next', () => {
    const nextMonday = at(2026, 11, 30);
    expect(nextWeekStart(NOW)).toBe(nextMonday);
    expect(nextWeekStart(at(2026, 11, 29, 23, 59, 59, 999))).toBe(nextMonday);
    expect(weekStart(nextMonday - 1)).toBe(at(2026, 11, 23));
    expect(weekStart(nextMonday)).toBe(nextMonday);
    expect(nextWeekStart(nextMonday)).toBe(at(2026, 12, 7));
  });

  it('keeps local midnights across the daylight-saving change that ends in November', () => {
    // Monday 26 Oct to Sunday 1 Nov 2026: clocks go back, so the week is 7 days and an hour long.
    const monday = at(2026, 10, 26);
    const nextMonday = at(2026, 11, 2);
    expect(nextMonday - monday).toBe(7 * DAY + HOUR);
    expect(weekStart(at(2026, 11, 1, 23, 59))).toBe(monday);
    expect(weekStart(at(2026, 11, 1, 1, 30))).toBe(monday);
    expect(nextWeekStart(at(2026, 11, 1, 23, 59))).toBe(nextMonday);
    expect(weekStart(nextMonday)).toBe(nextMonday);
    expect(weekStart(nextMonday - 1)).toBe(monday);
    // Monday 2 Nov is the next week's day one: counting back "7 days" from it would land an hour off.
    expect(weekStart(at(2026, 11, 2, 0, 30))).toBe(nextMonday);
  });

  it('keeps local midnights across the daylight-saving change that starts in March', () => {
    // Monday 2 Mar to Sunday 8 Mar 2026: clocks go forward, so the week is 7 days less an hour.
    const monday = at(2026, 3, 2);
    const nextMonday = at(2026, 3, 9);
    expect(nextMonday - monday).toBe(7 * DAY - HOUR);
    expect(weekStart(at(2026, 3, 8, 23, 59))).toBe(monday);
    expect(nextWeekStart(at(2026, 3, 8, 23, 59))).toBe(nextMonday);
    expect(weekStart(nextMonday)).toBe(nextMonday);
    expect(weekStart(nextMonday - 1)).toBe(monday);
  });
});

describe('which articles go in a list', () => {
  const all = [
    art('old', { lovedAt: at(2026, 10, 27) }),
    art('last-sunday', { lovedAt: at(2026, 11, 22, 23, 59, 59, 999) }),
    art('monday', { lovedAt: at(2026, 11, 23) }),
    art('recent', { lovedAt: at(2026, 11, 24, 18) }),
    art('newest', { lovedAt: NOW - 1000, archivedAt: NOW - 5000 }),
    art('plain'),
    art('gone', { lovedAt: NOW - 1000, deletedAt: NOW }),
    art('pasted', { source: 'text', url: '', lovedAt: NOW - 1000 }),
  ];

  it('lists loved articles newest love first, archived or not, and leaves out deleted ones', () => {
    expect(lovedArticles(all).map((a) => a.id)).toEqual(['newest', 'pasted', 'recent', 'monday', 'last-sunday', 'old']);
  });

  it('"this week" is this calendar week by love time, "all time" is everything shareable', () => {
    expect(listArticles(all, 'week', NOW).map((a) => a.id)).toEqual(['newest', 'recent', 'monday']);
    expect(listArticles(all, 'all', NOW).map((a) => a.id)).toEqual(['newest', 'recent', 'monday', 'last-sunday', 'old']);
  });

  it('leaves pasted text out of shared lists, since it has no link', () => {
    expect(listArticles(all, 'all', NOW).some((a) => a.id === 'pasted')).toBe(false);
  });

  it('counts each range, and a range with nothing in it counts zero', () => {
    expect(rangeCounts(all, NOW)).toEqual({ week: 3, all: 5 });
    expect(rangeCounts([art('x', { lovedAt: NOW - 40 * DAY })], NOW)).toEqual({ week: 0, all: 1 });
    expect(rangeCounts([], NOW)).toEqual({ week: 0, all: 0 });
  });

  it('counts up through the week and starts again on Monday', () => {
    // One story loved on Wednesday: it is on the list from then until Sunday night, then the count resets.
    const one = [art('wed', { lovedAt: at(2026, 11, 25, 8) })];
    expect(rangeCounts(one, at(2026, 11, 25, 8)).week).toBe(1);
    expect(rangeCounts(one, at(2026, 11, 28, 20)).week).toBe(1); // Saturday
    expect(rangeCounts(one, at(2026, 11, 29, 23, 59, 59, 999)).week).toBe(1); // Sunday, last millisecond
    expect(rangeCounts(one, at(2026, 11, 30)).week).toBe(0); // Monday 00:00: reset
    expect(rangeCounts(one, at(2026, 11, 30)).all).toBe(1); // still there under "All time"
  });

  it('puts an article loved at Monday 00:00 sharp in the new week and one loved a millisecond before in the old', () => {
    const edge = [art('before', { lovedAt: at(2026, 11, 30) - 1 }), art('after', { lovedAt: at(2026, 11, 30) })];
    expect(listArticles(edge, 'week', at(2026, 11, 29, 23, 59)).map((a) => a.id)).toEqual(['before']);
    expect(listArticles(edge, 'week', at(2026, 11, 30, 0, 1)).map((a) => a.id)).toEqual(['after']);
  });

  it('is not thrown by the daylight-saving week', () => {
    // Loved on Monday 26 Oct 00:00 and on Sunday 1 Nov 23:59: both are in that week, and Monday 2 Nov starts afresh.
    const dst = [art('first', { lovedAt: at(2026, 10, 26) }), art('last', { lovedAt: at(2026, 11, 1, 23, 59) }), art('earlier', { lovedAt: at(2026, 10, 25, 23, 59) })];
    expect(listArticles(dst, 'week', at(2026, 11, 1, 23, 59)).map((a) => a.id)).toEqual(['last', 'first']);
    expect(listArticles(dst, 'week', at(2026, 11, 2)).map((a) => a.id)).toEqual([]);
  });
});

describe('headline', () => {
  it('names the sharer, with a possessive that handles a trailing s', () => {
    expect(headline('Zach', 'week')).toBe('Zach’s reading this week');
    expect(headline('Zach', 'all')).toBe('Zach’s all-time favorites');
    expect(possessive('James')).toBe('James’');
    expect(headline('  ', 'week')).toBe('Worth reading this week');
    expect(headline(undefined, 'all')).toBe('All-time favorites');
  });
});

describe('what the card shows', () => {
  it('describes an article for the card', () => {
    const item = toShareItem(art('a', { byline: 'Someone', durationSec: 12 * 60, tintSource: '#2E4057' }));
    expect(item).toEqual({ title: 'Title a', url: 'https://example.com/a', domain: 'example.com', byline: 'Someone', minutes: 12, tint: '#2e4057' });
  });

  it('falls back to a derived color and the url as a title, and leaves out what it does not know', () => {
    const item = toShareItem(art('b', { title: 'https://example.com/b' }));
    expect(item.title).toBe('example.com/b');
    expect(item.tint).toMatch(/^#[0-9a-f]{6}$/);
    expect(item).not.toHaveProperty('byline');
    expect(item).not.toHaveProperty('minutes');
  });
});

describe('the signature of a list', () => {
  const list = () => [art('a', { lovedAt: 5, durationSec: 600, tintSource: '#112233', siteArtKey: 'site-a' }), art('b', { lovedAt: 4 })];
  const sig = listSignature(list());

  it('is the same for the same list, and ignores what the card does not show', () => {
    expect(listSignature(list())).toBe(sig);
    // Playing, being loved at another time, being archived: none of it changes a pixel.
    const [a, b] = list();
    expect(listSignature([{ ...a, positionSec: 300, archivedAt: 9, lovedAt: 99 }, b])).toBe(sig);
  });

  it('changes when the order or the articles change', () => {
    const [a, b] = list();
    expect(listSignature([b, a])).not.toBe(sig);
    expect(listSignature([a])).not.toBe(sig);
  });

  it('changes when anything the card draws changes, though the ids stay the same', () => {
    const [a, b] = list();
    const changed: Partial<Article>[] = [
      { title: 'The real title, once extraction finished' },
      { domain: 'other.example' },
      { tintSource: '#445566' },
      { articleArtKey: 'art-a' },
      { siteArtKey: 'site-a2' },
      { durationSec: 900 },
      { siteName: 'Example Times' },
    ];
    for (const patch of changed) expect(listSignature([{ ...a, ...patch }, b]), JSON.stringify(patch)).not.toBe(sig);
  });

  it('notices a URL title being replaced by the real one', () => {
    const url = 'https://example.com/a';
    const before = listSignature([art('a', { title: url })]);
    expect(listSignature([art('a', { title: 'A Real Headline' })])).not.toBe(before);
  });
});

describe('the file name of the card', () => {
  it('is the headline, lowercased and joined with hyphens', () => {
    expect(cardFileName('Zach’s reading this week')).toBe('zachs-reading-this-week.png');
    expect(cardFileName('All-time favorites')).toBe('all-time-favorites.png');
    expect(cardFileName('James’ all-time favorites')).toBe('james-all-time-favorites.png');
  });

  it('copes with a name that has nothing a file name can hold', () => {
    expect(cardFileName('???')).toBe('reader-list.png');
    expect(cardFileName('')).toBe('reader-list.png');
    expect(cardFileName('x'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
