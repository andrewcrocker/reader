// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { feedArtCandidates, feedHome, pageIcons } from './art';

describe('feedHome', () => {
  it('prefers where posts are read, then the site, then the feed', () => {
    expect(feedHome({ feedUrl: 'https://feeds.example/x.xml', siteUrl: 'https://blog.example/about', linkBase: 'https://moved.example' })).toBe('https://moved.example/');
    expect(feedHome({ feedUrl: 'https://feeds.example/x.xml', siteUrl: 'https://blog.example/about', linkBase: null })).toBe('https://blog.example/');
    expect(feedHome({ feedUrl: 'https://feeds.example/x.xml' })).toBe('https://feeds.example/');
    expect(feedHome({ feedUrl: 'not an address' })).toBeUndefined();
  });
});

describe('pageIcons', () => {
  const html = `<html><head>
    <link rel="icon" href="/small.png" sizes="32x32">
    <link rel="icon" href="https://cdn.example/big.png?fit=192%2C192&amp;ssl=1" sizes="192x192">
    <link rel="apple-touch-icon" href="/touch.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="stylesheet" href="/a.css">
    <link rel="icon" href="javascript:alert(1)" sizes="512x512">
  </head></html>`;

  it('lists the icons big enough for a row, largest first, as absolute addresses', () => {
    expect(pageIcons(html, 'https://blog.example/')).toEqual(['https://cdn.example/big.png?fit=192%2C192&ssl=1', 'https://blog.example/touch.png']);
  });

  it('finds nothing in a page with no icons', () => {
    expect(pageIcons('<html><head><title>x</title></head></html>', 'https://blog.example/')).toEqual([]);
  });
});

describe('feedArtCandidates', () => {
  it('tries the page icons, then the feed image, then the usual addresses, each once', () => {
    expect(feedArtCandidates('https://blog.example/', ['https://blog.example/apple-touch-icon.png'], 'https://blog.example/feed.png')).toEqual([
      'https://blog.example/apple-touch-icon.png',
      'https://blog.example/feed.png',
      'https://blog.example/favicon.ico',
    ]);
    expect(feedArtCandidates(undefined, [], undefined)).toEqual([]);
  });
});
