import { describe, expect, it } from 'vitest';
import { decodeList, encodeList, fitList, LIST_LINK_LIMIT, listLink, MAX_NOTE, readHash, classifyShare } from './share';

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

// A link made before notes existed, written by the old encoder (name and items only). It has to keep opening.
const OLD_LINK =
  'Xc2xCsIwFEbhV7n8g1NocA0UB3cdHcQhba80NE0k9woNpe8udhL3w3dWJD8zHG7ME6eBCvtBYBCUZ4G7r3iXCIdR9SXO2tT0QauNPrGcCj9bf-jaIww0aNyhsVIXJqY9oZjzRDoyyfdjIEG_1YUXpXPQis38Lzzn1PTZsoivYpcf_Jqoy4WHPGN7bB8';

const item = (i: number) => ({ url: `https://example.com/${crypto.randomUUID()}`, title: `Story ${i} ${crypto.randomUUID()}` });

describe('a note on a reading list', () => {
  const items = [{ url: 'https://aeon.co/essays/x', title: 'On boredom', site: 'Aeon' }];

  it('round-trips with the name and articles, through a link', async () => {
    const list = { name: 'Zach’s reading this week', note: 'Start with the first one. The rest are for the weekend.', items };
    expect(await decodeList(await encodeList(list))).toEqual(list);
    const { url } = await listLink('https://app.example', list);
    expect(await decodeList(readHash(new URL(url).hash).list!)).toEqual(list);
  });

  it('opens a link made before notes existed exactly as it did', async () => {
    const list = await decodeList(OLD_LINK);
    expect(list).toEqual({
      name: 'Weekend reads',
      items: [
        { url: 'https://n.city/lanes?ref=a&b=1', title: 'Why bike lanes look the same', site: 'Next City' },
        { url: 'https://aeon.co/essays/x', title: 'On boredom' },
      ],
    });
    expect(list).not.toHaveProperty('note');
  });

  it('writes nothing for a blank note, so the link is the same as one without a note', async () => {
    expect(await encodeList({ items, note: '  \n ' })).toBe(await encodeList({ items }));
    expect(await decodeList(await encodeList({ items, note: '   ' }))).toEqual({ items });
  });

  it('keeps a note to one line and cuts a long one, when making a link and when opening one', async () => {
    expect((await decodeList(await encodeList({ items, note: 'First line.\n\n  Second\tline.' })))?.note).toBe('First line. Second line.');
    const long = 'word '.repeat(100);
    const made = await decodeList(await encodeList({ items, note: long }));
    expect(made!.note!.length).toBeLessThanOrEqual(MAX_NOTE);
    expect(made!.note!.length).toBeGreaterThan(MAX_NOTE - 10);
    // A link from somewhere else, with a note longer than ours allows.
    const raw = Buffer.from(await deflate(JSON.stringify({ note: 'x'.repeat(5000), items })));
    expect((await decodeList(raw.toString('base64url')))?.note).toHaveLength(MAX_NOTE);
  });

  it('ignores a note that is not text, and opens the list anyway', async () => {
    for (const note of [42, null, true, ['a'], { a: 1 }]) {
      const raw = Buffer.from(await deflate(JSON.stringify({ name: 'N', note, items })));
      expect(await decodeList(raw.toString('base64url'))).toEqual({ name: 'N', items });
    }
  });
});

/** deflate-raw, the way a link is compressed. */
async function deflate(json: string): Promise<Uint8Array> {
  const out = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

describe('fitting a list into one link', () => {
  const origin = 'https://app.example';

  it('leaves a list that fits alone', async () => {
    const list = { name: 'Zach’s reading this week', items: Array.from({ length: 5 }, (_, i) => item(i)) };
    const fit = await fitList(origin, list);
    expect(fit.dropped).toBe(0);
    expect(fit.list).toBe(list);
    expect(fit.tooLong).toBe(false);
    expect(fit.url).toBe((await listLink(origin, list)).url);
  });

  it('keeps the first articles that fit and says how many it cut', async () => {
    const list = { name: 'Zach’s all-time favorites', note: 'Start with the first one.', items: Array.from({ length: 80 }, (_, i) => item(i)) };
    const fit = await fitList(origin, list);
    const kept = fit.list.items.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(80);
    expect(fit.dropped).toBe(80 - kept);
    expect(fit.tooLong).toBe(false);
    expect(fit.url.length).toBeLessThanOrEqual(LIST_LINK_LIMIT);
    // The newest (first) ones are the ones kept, and the link opens to exactly them, with the name and note.
    expect(fit.list.items).toEqual(list.items.slice(0, kept));
    expect(await decodeList(readHash(new URL(fit.url).hash).list!)).toEqual({ name: list.name, note: list.note, items: list.items.slice(0, kept) });
    // One more would not have fit.
    expect((await listLink(origin, { ...list, items: list.items.slice(0, kept + 1) })).url.length).toBeGreaterThan(LIST_LINK_LIMIT);
  });

  it('counts the name and the note, so a long note leaves room for fewer articles', async () => {
    const items = Array.from({ length: 80 }, (_, i) => item(i));
    const plain = await fitList(origin, { items });
    const noted = await fitList(origin, { note: Array.from({ length: 20 }, () => crypto.randomUUID().slice(0, 7)).join(' ').slice(0, MAX_NOTE), items });
    expect(noted.list.items.length).toBeLessThan(plain.list.items.length);
    expect(noted.url.length).toBeLessThanOrEqual(LIST_LINK_LIMIT);
  });

  it('takes the limit as a parameter', async () => {
    const list = { items: Array.from({ length: 10 }, (_, i) => item(i)) };
    const fit = await fitList(origin, list, 400);
    expect(fit.url.length).toBeLessThanOrEqual(400);
    expect(fit.list.items.length).toBeLessThan(10);
    expect(fit.dropped).toBe(10 - fit.list.items.length);
  });

  it('keeps one article even when its link alone is too long, and flags it', async () => {
    // Random text doesn't compress, so this one article's link is over the limit on its own.
    const long = { url: `https://example.com/${Array.from({ length: 100 }, () => crypto.randomUUID()).join('')}`, title: 'A very long address' };
    const list = { items: [long, item(1), item(2)] };
    const fit = await fitList(origin, list);
    expect(fit.list.items).toEqual([long]);
    expect(fit.dropped).toBe(2);
    expect(fit.tooLong).toBe(true);
  });
});

