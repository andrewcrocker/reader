import { describe, expect, it } from 'vitest';
import { DOMParser as LinkedomParser } from 'linkedom';
import { setHtmlParser } from './dom';
import { parseArticle } from './extract';
import { htmlToBlocks } from './textprep';

// No DOMParser in this environment, like the service worker: extraction must run on linkedom.
setHtmlParser((html) => new LinkedomParser().parseFromString(html, 'text/html') as unknown as Document);

const para = (n: number) =>
  `<p>Paragraph ${n} of the story goes on at some length about the town library, its long hours, and the people who come in to get out of the rain and read the papers.</p>`;

const page = `<!doctype html><html><head>
  <title>The Town Library | Example News</title>
  <meta property="og:site_name" content="Example News">
  <meta property="og:image" content="/img/lead.jpg">
  <link rel="canonical" href="/stories/library">
  <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
</head><body>
  <nav><a href="/">Home</a> <a href="/news">News</a></nav>
  <article><h1>The Town Library</h1>${[1, 2, 3, 4, 5, 6].map(para).join('')}
    <aside class="newsletter">Sign up for our newsletter</aside>
  </article>
  <footer>© Example News</footer>
</body></html>`;

describe('extraction without a native DOM (service worker)', () => {
  it('parses an article with linkedom', () => {
    expect(typeof DOMParser).toBe('undefined');
    const x = parseArticle(page, 'https://news.example.com/stories/library?utm=x');
    expect(x.siteName).toBe('Example News');
    expect(x.canonicalUrl).toBe('https://news.example.com/stories/library');
    expect(x.imageUrl).toBe('https://news.example.com/img/lead.jpg');
    expect(x.iconUrl).toBe('https://news.example.com/icon-180.png');
    const blocks = htmlToBlocks(x.contentHtml);
    expect(blocks.filter((b) => b.kind === 'para')).toHaveLength(6);
    expect(blocks.map((b) => b.text).join(' ')).not.toMatch(/newsletter|Home/);
  });
});
