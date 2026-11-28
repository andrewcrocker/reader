// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wpcomArticle, wpcomFeed, wpcomFeedUrl } from './wpcom';

const SITE = { name: 'A Collection of Unmitigated Pedantry', URL: 'https://acoup.blog', icon: { img: 'https://i0.wp.com/acoup.blog/icon.jpg' } };
const POST = {
  guid: 'https://acoup.blog/?p=38161',
  URL: 'https://acoup.blog/2026/11/20/collections-on-the-sullan-republic/',
  title: 'Collections: On the &#8216;Sullan Republic&#8217;',
  date: '2026-11-20T17:59:38-05:00',
  content: '<p>Body</p>',
  author: { name: 'Bret Devereaux' },
  featured_image: 'https://i0.wp.com/acoup.blog/sulla.jpg',
};

/** A fake API: a table of path fragments -> JSON. Anything else is "not a WordPress.com site". Records what was asked for. */
function api(routes: Record<string, unknown>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    asked.push(u);
    const hit = Object.keys(routes).find((k) => u.includes(k));
    return hit ? Response.json(routes[hit]) : Response.json({ error: 'unauthorized' }, { status: 403 });
  }));
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('wpcomFeed', () => {
  it('reads a blog and its posts straight from the API, by host', async () => {
    const asked = api({ '/posts?': { posts: [POST, { title: 'no address' }] }, 'acoup.blog?': SITE });
    const feed = await wpcomFeed('https://acoup.blog/feed');
    expect(feed).toMatchObject({ title: SITE.name, siteUrl: 'https://acoup.blog/', imageUrl: SITE.icon.img });
    expect(feed?.items).toEqual([{ guid: POST.guid, link: POST.URL, title: 'Collections: On the ‘Sullan Republic’', publishedAt: Date.parse(POST.date) }]);
    expect(asked.every((u) => u.startsWith('https://public-api.wordpress.com/rest/v1.1/sites/acoup.blog'))).toBe(true);
  });

  it('is null for a site WordPress.com does not host, and when offline', async () => {
    api({});
    expect(await wpcomFeed('https://example.com/')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await wpcomFeed('https://acoup.blog/')).toBeNull();
    expect(await wpcomFeed('not an address')).toBeNull();
  });

  it('still lists the posts when the blog’s name can’t be read', async () => {
    api({ '/posts?': { posts: [POST] } });
    expect(await wpcomFeed('https://acoup.blog/')).toMatchObject({ title: '', siteUrl: 'https://acoup.blog/', items: [{ link: POST.URL }] });
  });
});

describe('wpcomFeedUrl', () => {
  it('is the same for a blog’s home page, its feed and its posts', () => {
    for (const a of ['https://acoup.blog/', 'https://acoup.blog/feed', POST.URL]) expect(wpcomFeedUrl(a)).toBe('https://acoup.blog/feed/');
    expect(wpcomFeedUrl('nope')).toBeUndefined();
  });
});

describe('wpcomArticle', () => {
  it('finds a post by the slug its address ends in', async () => {
    const asked = api({ '/posts/slug:collections-on-the-sullan-republic?': POST, 'acoup.blog?': SITE });
    expect(await wpcomArticle(POST.URL)).toMatchObject({
      link: POST.URL,
      title: 'Collections: On the ‘Sullan Republic’',
      contentHtml: '<p>Body</p>',
      byline: 'Bret Devereaux',
      imageUrl: POST.featured_image,
      siteName: SITE.name,
      iconUrl: SITE.icon.img,
    });
    expect(asked).toHaveLength(2);
  });

  it('asks nothing for an address with no slug', async () => {
    const asked = api({});
    expect(await wpcomArticle('https://acoup.blog/')).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('is null for a missing post, an empty one, or another post with the same slug', async () => {
    api({});
    expect(await wpcomArticle(POST.URL)).toBeNull();
    api({ '/posts/slug:': { ...POST, content: '' } });
    expect(await wpcomArticle(POST.URL)).toBeNull();
    api({ '/posts/slug:': POST });
    expect(await wpcomArticle('https://acoup.blog/2019/01/01/collections-on-the-sullan-republic/')).toBeNull();
  });
});
