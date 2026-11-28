import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chunk, Settings } from '../db';

vi.mock('../app/invite', () => ({ noteInviteRejected: vi.fn() }));
const { isCacheable, submitJob } = await import('./server');

afterEach(() => vi.unstubAllGlobals());

describe('isCacheable', () => {
  it('is true for an article fetched from a URL', () => {
    expect(isCacheable({ source: 'url' })).toBe(true);
  });
  it('is false for pasted text and uploaded files, which can be private', () => {
    expect(isCacheable({ source: 'text', pastedText: 'my notes' })).toBe(false);
    expect(isCacheable({ source: 'file' })).toBe(false);
  });
  it('is false for a URL article whose text was pasted over the fetched text', () => {
    expect(isCacheable({ source: 'url', pastedText: 'the full text' })).toBe(false);
  });
});

describe('submitJob', () => {
  const s = { proxyUrl: 'https://worker.example/', proxySecret: 'k' } as Settings;
  const chunks = [{ i: 0, text: 'Hello.', sentenceStart: 0, sentenceCount: 1, pauseAfter: 0.5 }] as Chunk[];
  const sent = () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ job: 'j1' }, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    return () => fetchMock.mock.calls[0][1].body as string;
  };

  it('sends the same body as before unless the article is cacheable', async () => {
    const body = sent();
    expect(await submitJob(s, 'af_heart', chunks)).toBe('j1');
    expect(body()).toBe('{"voice":"af_heart","chunks":[{"i":0,"text":"Hello."}]}');
  });
  it('adds cacheable: true for a cacheable article', async () => {
    const body = sent();
    await submitJob(s, 'af_heart', chunks, true);
    expect(JSON.parse(body())).toEqual({ voice: 'af_heart', chunks: [{ i: 0, text: 'Hello.' }], cacheable: true });
  });
  it('leaves cacheable out when it is false', async () => {
    const body = sent();
    await submitJob(s, 'af_heart', chunks, false);
    expect(body()).not.toContain('cacheable');
  });
});
