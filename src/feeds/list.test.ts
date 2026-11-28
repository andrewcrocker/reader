import { describe, expect, it } from 'vitest';
import type { Feed } from '../db';
import { summarizeFeeds } from './list';

const feed = (id: string, title: string, addedAt = 0): Feed => ({ id, title, feedUrl: `https://${id}.example/feed`, addedAt });
const post = (feedId: string, publishedAt: number | undefined, seen = true, firstSeenAt = 1) => ({ feedId, publishedAt, firstSeenAt, seenAt: seen ? 5 : null });
const ids = (rows: { feed: Feed }[]) => rows.map((r) => r.feed.id);

describe('summarizeFeeds', () => {
  const feeds = [feed('a', 'Zebra Notes'), feed('b', 'The Apple Blog'), feed('c', 'mango')];

  it('counts unseen posts per blog and finds its latest post', () => {
    const rows = summarizeFeeds(feeds, [post('a', 10, false), post('a', 30, false), post('a', 20), post('b', 5)], 'alpha');
    const a = rows.find((r) => r.feed.id === 'a')!;
    expect(a.unseen).toBe(2);
    expect(a.latest).toBe(30);
    expect(rows.find((r) => r.feed.id === 'b')!.unseen).toBe(0);
    expect(rows.find((r) => r.feed.id === 'c')).toMatchObject({ unseen: 0, latest: undefined });
  });

  it('recent: the blog that posted last comes first', () => {
    expect(ids(summarizeFeeds(feeds, [post('a', 10), post('b', 30), post('c', 20)], 'recent'))).toEqual(['b', 'c', 'a']);
  });

  it('recent: a post with no date counts from when it was first seen, and a blog with no posts from when it was added', () => {
    const rows = summarizeFeeds([feed('a', 'A', 25), feed('b', 'B'), feed('c', 'C')], [post('b', undefined, true, 40), post('c', 30)], 'recent');
    expect(ids(rows)).toEqual(['b', 'c', 'a']);
  });

  it('alpha: by name, ignoring case and a leading "The"', () => {
    expect(ids(summarizeFeeds(feeds, [post('a', 99)], 'alpha'))).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by name, so the order is the same every time', () => {
    const tied = [feed('x', 'Same'), feed('y', 'Other')];
    expect(ids(summarizeFeeds(tied, [post('x', 7), post('y', 7)], 'recent'))).toEqual(['y', 'x']);
    expect(ids(summarizeFeeds([feed('2', 'Same'), feed('1', 'Same')], [], 'alpha'))).toEqual(['1', '2']);
  });
});
