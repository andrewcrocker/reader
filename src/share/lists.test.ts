import { describe, expect, it } from 'vitest';
import type { Article } from '../db';
import { headline, listArticles, possessive, publishRequest, rangeCounts, starredArticles, toShareItem, WEEK_MS } from './lists';

const NOW = Date.UTC(2026, 10, 26, 12);
const DAY = 24 * 60 * 60 * 1000;
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

describe('which articles go in a list', () => {
  const all = [
    art('old', { starredAt: NOW - 30 * DAY }),
    art('recent', { starredAt: NOW - 2 * DAY }),
    art('newest', { starredAt: NOW - 1000, archivedAt: NOW - 5000 }),
    art('edge', { starredAt: NOW - WEEK_MS }),
    art('plain'),
    art('gone', { starredAt: NOW - 1000, deletedAt: NOW }),
    art('pasted', { source: 'text', url: '', starredAt: NOW - 1000 }),
  ];

  it('lists starred articles newest star first, archived or not, and leaves out deleted ones', () => {
    expect(starredArticles(all).map((a) => a.id)).toEqual(['newest', 'pasted', 'recent', 'edge', 'old']);
  });

  it('"this week" is the last seven days by star time, "all time" is everything shareable', () => {
    expect(listArticles(all, 'week', NOW).map((a) => a.id)).toEqual(['newest', 'recent', 'edge']);
    expect(listArticles(all, 'all', NOW).map((a) => a.id)).toEqual(['newest', 'recent', 'edge', 'old']);
  });

  it('leaves pasted text out of shared lists, since it has no link', () => {
    expect(listArticles(all, 'all', NOW).some((a) => a.id === 'pasted')).toBe(false);
  });

  it('counts each range, and a range with nothing in it counts zero', () => {
    expect(rangeCounts(all, NOW)).toEqual({ week: 3, all: 4 });
    expect(rangeCounts([art('x', { starredAt: NOW - 40 * DAY })], NOW)).toEqual({ week: 0, all: 1 });
    expect(rangeCounts([], NOW)).toEqual({ week: 0, all: 0 });
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

describe('what is published', () => {
  it('describes an article for the page and the card', () => {
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

  it('builds the request: headline, trimmed name and note, newest first, capped at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => art(`n${i}`, { starredAt: NOW - i * 1000 }));
    const req = publishRequest(many, 'all', '  Zach  ', '  Start   here.  ', NOW);
    expect(req).toMatchObject({ title: 'Zach’s all-time favorites', name: 'Zach', note: 'Start here.', range: 'all' });
    expect(req.items).toHaveLength(50);
    expect(req.items[0].title).toBe('Title n0');
  });

  it('omits an empty name and note', () => {
    const req = publishRequest([art('a', { starredAt: NOW })], 'week', ' ', '', NOW);
    expect(req).not.toHaveProperty('name');
    expect(req).not.toHaveProperty('note');
    expect(req.title).toBe('Worth reading this week');
  });
});
