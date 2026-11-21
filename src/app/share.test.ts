import { describe, expect, it } from 'vitest';
import { decodeList, encodeList, LIST_LINK_LIMIT, listLink, readHash, classifyShare } from './share';

describe('classifyShare', () => {
  it('uses the url field when present', () => {
    expect(classifyShare({ url: 'https://a.com/x', title: 'T', text: 'whatever' })).toEqual({ kind: 'link', url: 'https://a.com/x', title: 'T' });
  });
  it('treats a lone URL in text as a link', () => {
    expect(classifyShare({ text: 'https://a.com/x' })).toEqual({ kind: 'link', url: 'https://a.com/x', title: undefined });
  });
  it('treats "Headline https://…" as a link with the headline as title', () => {
    expect(classifyShare({ text: 'Why bike lanes look the same - https://n.city/lanes.' })).toEqual({ kind: 'link', url: 'https://n.city/lanes', title: 'Why bike lanes look the same' });
  });
  it('treats long text, or text with several links, as text', () => {
    const long = `${'word '.repeat(80)}https://a.com/x`;
    expect(classifyShare({ text: long })?.kind).toBe('text');
    expect(classifyShare({ text: 'see https://a.com and https://b.com', title: 'Notes' })).toEqual({ kind: 'text', text: 'see https://a.com and https://b.com', title: 'Notes' });
  });
  it('returns null for an empty share', () => {
    expect(classifyShare({ text: '  ' })).toBeNull();
  });
});

describe('readHash', () => {
  it('reads invite and add', () => {
    expect(readHash('#invite=s3cret')).toEqual({ invite: 's3cret', add: undefined, list: undefined });
    expect(readHash('#add=https%3A%2F%2Fa.com%2Fx')).toEqual({ invite: undefined, add: 'https://a.com/x', list: undefined });
  });
  it('reads a list without mangling base64url', () => {
    expect(readHash('#list=ab-_9Z').list).toBe('ab-_9Z');
  });
});

describe('reading lists', () => {
  const list = {
    name: 'Weekend reads',
    items: [
      { url: 'https://n.city/lanes?ref=a&b=1', title: 'Why bike lanes look the same', site: 'Next City' },
      { url: 'https://aeon.co/essays/x', title: 'On boredom — “a mood” ✓' },
    ],
  };

  it('round-trips name, titles, sites and unicode', async () => {
    const enc = await encodeList(list);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeList(enc)).toEqual(list);
  });

  it('survives the trip through a link and readHash', async () => {
    const { url, tooLong } = await listLink('https://app.example', list);
    expect(tooLong).toBe(false);
    expect(url.startsWith('https://app.example/#list=')).toBe(true);
    expect(await decodeList(readHash(new URL(url).hash).list!)).toEqual(list);
  });

  it('leaves out an empty name', async () => {
    expect(await decodeList(await encodeList({ name: '  ', items: list.items }))).toEqual({ items: list.items });
  });

  it('flags lists too long for a comfortable link', async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ url: `https://example.com/${crypto.randomUUID()}`, title: `Story ${i} ${crypto.randomUUID()}` }));
    const { url, tooLong } = await listLink('https://app.example', { items });
    expect(url.length).toBeGreaterThan(LIST_LINK_LIMIT);
    expect(tooLong).toBe(true);
    expect((await decodeList(readHash(new URL(url).hash).list!))?.items).toHaveLength(80);
  });

  it('keeps ten typical articles under the limit', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ url: `https://www.theatlantic.com/ideas/archive/2026/11/some-article-slug-${i}/680000/`, title: `A typical headline about something, number ${i}`, site: 'The Atlantic' }));
    expect((await listLink('https://read-aloud.pages.dev', { items })).tooLong).toBe(false);
  });

  it('rejects damaged data and drops non-web links', async () => {
    expect(await decodeList('not base64 !!')).toBeNull();
    expect(await decodeList('AAAA')).toBeNull();
    const enc = await encodeList({ items: [{ url: 'javascript:alert(1)', title: 'x' }, { url: 'https://ok.com/a', title: '' }] });
    expect(await decodeList(enc)).toEqual({ items: [{ url: 'https://ok.com/a', title: 'https://ok.com/a' }] });
  });
});
