// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ATOM_FEED, VITALIK_FEED, VITALIK_HOME } from './fixtures';
import { commonFeedUrls, discoverFeedLinks, normalizeAddress, parseFeed } from './parse';

const FEED_URL = 'https://vitalik.eth.limo/feed.xml';

describe('parseFeed: RSS 2.0', () => {
  it('reads Vitalik’s real feed', () => {
    const feed = parseFeed(VITALIK_FEED, FEED_URL)!;
    expect(feed.title).toBe("Vitalik Buterin's website");
    expect(feed.siteUrl).toBe('https://vitalik.ca/');
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]).toEqual({
      guid: 'https://vitalik.ca/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html',
      link: 'https://vitalik.ca/general/2026/11/26/a_shallow_dive_into_open-source_chip_design.html',
      title: 'A shallow dive into open-source chip design',
      publishedAt: Date.UTC(2026, 10, 26),
    });
    expect(feed.items[2].title).toBe('Über Kollusion');
    expect(feed.items[2].publishedAt).toBe(Date.UTC(2000, 0, 1));
  });

  it('takes the page link, not <atom:link rel="self">, and reads CDATA, entities and dc:date', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel>
          <title>Blog</title>
          <atom:link href="https://b.example/feed" rel="self" type="application/rss+xml"/>
          <link>https://b.example/</link>
          <item>
            <title><![CDATA[Fish & chips]]></title>
            <link>https://b.example/fish</link>
            <dc:date>2026-11-02T12:00:00Z</dc:date>
          </item>
          <item>
            <title>Curly &#8217;quotes&#8217;</title>
            <link>/relative</link>
          </item>
        </channel>
      </rss>`;
    const feed = parseFeed(xml, 'https://b.example/feed')!;
    expect(feed.siteUrl).toBe('https://b.example/');
    expect(feed.items.map((i) => i.title)).toEqual(['Fish & chips', 'Curly ’quotes’']);
    expect(feed.items[0].publishedAt).toBe(Date.UTC(2026, 10, 2, 12));
    expect(feed.items[1]).toMatchObject({ link: 'https://b.example/relative', publishedAt: undefined });
  });

  it('falls back to a permalink guid, skips posts it can’t link to, and uses the link for a missing title', () => {
    const xml = `<rss version="2.0"><channel><title>B</title>
      <item><title>Guid only</title><guid>https://b.example/g</guid></item>
      <item><title>Opaque guid</title><guid isPermaLink="false">post-17</guid></item>
      <item><link>https://b.example/untitled</link></item>
      <item><title>Not web</title><link>mailto:a@b.example</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, 'https://b.example/feed')!.items;
    expect(items.map((i) => i.link)).toEqual(['https://b.example/g', 'https://b.example/untitled']);
    expect(items[1].title).toBe('https://b.example/untitled');
  });

  it('keeps an opaque guid as the id and tolerates a byte-order mark and blank lines before the declaration', () => {
    const xml = `﻿\n\n<?xml version="1.0"?><rss version="2.0"><channel><title>B</title>
      <item><title>One</title><link>https://b.example/1</link><guid isPermaLink="false">id-1</guid></item></channel></rss>`;
    expect(parseFeed(xml, 'https://b.example/feed')!.items[0].guid).toBe('id-1');
  });
});

describe('parseFeed: Atom', () => {
  it('reads titles, the alternate link, relative links, ids and dates', () => {
    const feed = parseFeed(ATOM_FEED, 'https://notes.example.com/atom.xml')!;
    expect(feed.title).toBe('Field Notes');
    expect(feed.siteUrl).toBe('https://notes.example.com/');
    expect(feed.items).toEqual([
      {
        guid: 'tag:notes.example.com,2026:tom-and-jerry',
        link: 'https://notes.example.com/posts/tom-and-jerry',
        title: 'Tom & Jerry revisited',
        publishedAt: Date.UTC(2026, 10, 20, 10),
      },
      {
        guid: 'tag:notes.example.com,2026:updated-only',
        link: 'https://notes.example.com/posts/updated-only',
        title: 'Updated only',
        publishedAt: Date.UTC(2026, 10, 1, 9),
      },
    ]);
  });
});

describe('parseFeed: RSS 1.0 and non-feeds', () => {
  it('reads RSS 1.0 (RDF), where items sit beside the channel', () => {
    const xml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel rdf:about="https://old.example/"><title>Old blog</title><link>https://old.example/</link></channel>
        <item><title>Hello</title><link>https://old.example/hello</link><dc:date>2026-01-05T00:00:00Z</dc:date></item>
      </rdf:RDF>`;
    const feed = parseFeed(xml, 'https://old.example/rss')!;
    expect(feed.title).toBe('Old blog');
    expect(feed.items).toEqual([{ guid: undefined, link: 'https://old.example/hello', title: 'Hello', publishedAt: Date.UTC(2026, 0, 5) }]);
  });

  it('returns null for an HTML page, broken XML, other XML and nothing', () => {
    expect(parseFeed(VITALIK_HOME, 'https://vitalik.eth.limo/')).toBeNull();
    expect(parseFeed('<rss version="2.0"><channel><title>Cut off', FEED_URL)).toBeNull();
    expect(parseFeed('<?xml version="1.0"?><sitemap><url>x</url></sitemap>', FEED_URL)).toBeNull();
    expect(parseFeed('', FEED_URL)).toBeNull();
  });

  it('accepts a feed with no posts yet', () => {
    expect(parseFeed('<rss version="2.0"><channel><title>New</title></channel></rss>', FEED_URL)).toEqual({ title: 'New', siteUrl: undefined, items: [] });
  });
});

describe('discoverFeedLinks', () => {
  it('finds the feed Vitalik’s home page links to, resolved against the page address', () => {
    expect(discoverFeedLinks(VITALIK_HOME, 'https://vitalik.eth.limo/')).toEqual(['https://vitalik.eth.limo/feed.xml']);
  });

  it('takes RSS and Atom alternates in page order and ignores the rest', () => {
    const html = `<head>
      <link rel="stylesheet" type="application/rss+xml" href="/not-a-feed.css">
      <link rel="alternate" hreflang="fr" type="text/html" href="/fr/">
      <link rel="alternate" type="application/atom+xml; charset=utf-8" href="https://b.example/atom.xml">
      <link rel="ALTERNATE home" type="application/rss+xml" href="/rss">
      <link rel="alternate" type="application/rss+xml" href="/rss">
      <link rel="alternate" type="application/rss+xml" href="javascript:void(0)">
      <link rel="alternate" type="application/rss+xml">
    </head>`;
    expect(discoverFeedLinks(html, 'https://b.example/blog/')).toEqual(['https://b.example/atom.xml', 'https://b.example/rss']);
  });

  it('finds nothing in a page without feed links', () => {
    expect(discoverFeedLinks('<html><body>hi</body></html>', 'https://b.example/')).toEqual([]);
  });
});

describe('commonFeedUrls', () => {
  it('lists the usual paths on the site’s origin, in order', () => {
    expect(commonFeedUrls('https://b.example/blog/post?x=1')).toEqual([
      'https://b.example/feed.xml',
      'https://b.example/feed',
      'https://b.example/rss.xml',
      'https://b.example/atom.xml',
      'https://b.example/index.xml',
    ]);
  });
});

describe('normalizeAddress', () => {
  it.each([
    ['https://vitalik.eth.limo/', 'https://vitalik.eth.limo/'],
    ['  vitalik.eth.limo  ', 'https://vitalik.eth.limo/'],
    ['example.com/blog', 'https://example.com/blog'],
    ['feed://example.com/rss', 'https://example.com/rss'],
    ['http://example.com', 'http://example.com/'],
  ])('%s -> %s', (input, out) => expect(normalizeAddress(input)).toBe(out));

  it.each(['', 'hello', 'two words.com', 'ftp://example.com/', 'javascript:alert(1)', 'localhost'])('rejects %j', (input) => expect(normalizeAddress(input)).toBeUndefined());
});
