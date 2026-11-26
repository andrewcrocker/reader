// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { discoverFeed, FeedError, type FetchText } from './discover';
import { ATOM_FEED, VITALIK_FEED, VITALIK_HOME } from './fixtures';

/** A fake proxy: a table of address -> body. Anything else is a 404. Records what was asked for. */
function proxy(pages: Record<string, string>, redirects: Record<string, string> = {}) {
  const asked: string[] = [];
  const fetchText: FetchText = async (url) => {
    asked.push(url);
    const body = pages[redirects[url] ?? url];
    if (body === undefined) throw new Error('404');
    return { text: body, finalUrl: redirects[url] ?? url };
  };
  return { fetchText, asked };
}

describe('discoverFeed', () => {
  it('finds Vitalik’s feed from his site address, through the page’s <link> tag', async () => {
    const { fetchText, asked } = proxy({ 'https://vitalik.eth.limo/': VITALIK_HOME, 'https://vitalik.eth.limo/feed.xml': VITALIK_FEED });
    const found = await discoverFeed('https://vitalik.eth.limo/', fetchText);
    expect(found.feedUrl).toBe('https://vitalik.eth.limo/feed.xml');
    expect(found.feed.title).toBe("Vitalik Buterin's website");
    expect(found.feed.items).toHaveLength(3);
    expect(asked).toEqual(['https://vitalik.eth.limo/', 'https://vitalik.eth.limo/feed.xml']);
  });

  it('takes a bare address, and uses a feed address as it is', async () => {
    const { fetchText, asked } = proxy({ 'https://vitalik.eth.limo/feed.xml': VITALIK_FEED });
    const found = await discoverFeed('vitalik.eth.limo/feed.xml', fetchText);
    expect(found.feedUrl).toBe('https://vitalik.eth.limo/feed.xml');
    expect(asked).toEqual(['https://vitalik.eth.limo/feed.xml']);
  });

  it('names the feed by where the request ended up (redirects, http to https)', async () => {
    const { fetchText } = proxy({ 'https://notes.example.com/atom.xml': ATOM_FEED }, { 'http://notes.example.com/atom.xml': 'https://notes.example.com/atom.xml' });
    expect((await discoverFeed('http://notes.example.com/atom.xml', fetchText)).feedUrl).toBe('https://notes.example.com/atom.xml');
  });

  it('tries the common paths, in order, when the page links to no feed, skipping misses and pages that aren’t feeds', async () => {
    const { fetchText, asked } = proxy({
      'https://b.example/blog/': '<html><body>No feed link here</body></html>',
      'https://b.example/feed': '<html><body>A single-page app answering everything</body></html>',
      'https://b.example/atom.xml': ATOM_FEED,
    });
    const found = await discoverFeed('https://b.example/blog/', fetchText);
    expect(found.feedUrl).toBe('https://b.example/atom.xml');
    expect(asked).toEqual(['https://b.example/blog/', 'https://b.example/feed.xml', 'https://b.example/feed', 'https://b.example/rss.xml', 'https://b.example/atom.xml']);
  });

  it('prefers what the page links to over guesses, and does not ask twice for the same address', async () => {
    const { fetchText, asked } = proxy({
      'https://b.example/': '<link rel="alternate" type="application/atom+xml" href="/feed.xml"><link rel="alternate" type="application/atom+xml" href="/feed.xml">',
      'https://b.example/feed.xml': '<html>not a feed after all</html>',
      'https://b.example/rss.xml': ATOM_FEED,
    });
    expect((await discoverFeed('https://b.example/', fetchText)).feedUrl).toBe('https://b.example/rss.xml');
    expect(asked.filter((u) => u.endsWith('/feed.xml'))).toHaveLength(1);
  });

  it('says so plainly when nothing is found', async () => {
    const { fetchText } = proxy({ 'https://b.example/': '<html></html>' });
    await expect(discoverFeed('https://b.example/', fetchText)).rejects.toThrow(new FeedError('Couldn’t find a feed at that address.'));
  });

  it('passes on why the pasted address itself couldn’t be fetched', async () => {
    const { fetchText } = proxy({});
    await expect(discoverFeed('https://b.example/', fetchText)).rejects.toThrow('404');
  });

  it('rejects something that isn’t an address without fetching', async () => {
    const { fetchText, asked } = proxy({});
    await expect(discoverFeed('not an address', fetchText)).rejects.toBeInstanceOf(FeedError);
    expect(asked).toEqual([]);
  });
});
