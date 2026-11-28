import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../db';

// Just enough of Dexie for submitPending: a table of articles and empty chunk tables.
const fake = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const empty = { where: () => ({ equals: () => ({ primaryKeys: async () => [] }) }) };
  const db = {
    articles: {
      toArray: async () => [...rows.values()],
      bulkGet: async (ids: string[]) => ids.map((id) => rows.get(id)),
      get: async (id: string) => rows.get(id),
      update: async (id: string, patch: object) => (Object.assign(rows.get(id)!, patch), 1),
    },
    renderedChunks: empty,
    serverAudio: empty,
  };
  return { rows, db };
});
vi.mock('../db', () => ({ db: fake.db, getSettings: async () => ({ engineKind: 'server', proxyUrl: 'https://w.example', proxySecret: 'k' }) }));

const server = vi.hoisted(() => ({
  submitJob: vi.fn(async (..._args: unknown[]) => 'job-1'),
  jobStatus: vi.fn(),
  fetchChunkBytes: vi.fn(),
}));
const { submitJob } = server;
vi.mock('../tts/server', async (orig) => ({ ...(await orig<typeof import('../tts/server')>()), ...server }));
vi.mock('../app/invite', () => ({ noteInviteRejected: vi.fn() }));

const { downloadChunks, submitPending } = await import('./serverSync');

const chunks = [{ i: 0, text: 'Hello.', sentenceStart: 0, sentenceCount: 1, pauseAfter: 0.5 }];
const article = (id: string, extra: Partial<Article>): Article =>
  ({ id, source: 'url', url: 'https://x.com/a', title: id, savedAt: 1, status: 'extracted', sentences: [], positionSec: 0, queueOrder: 1, chunks, ...extra }) as Article;

describe('submitPending', () => {
  beforeEach(() => {
    fake.rows.clear();
    submitJob.mockClear();
  });
  const sentCacheable = async (a: Article) => {
    fake.rows.set(a.id, { ...a });
    await submitPending();
    return (submitJob.mock.calls[0] as unknown[])[3];
  };

  it('marks an article fetched from a URL cacheable', async () => {
    expect(await sentCacheable(article('url', {}))).toBe(true);
  });
  it('does not mark pasted text, an uploaded file, or a URL article with pasted text cacheable', async () => {
    expect(await sentCacheable(article('text', { source: 'text', url: '', pastedText: 'private notes' }))).toBe(false);
    submitJob.mockClear();
    expect(await sentCacheable(article('file', { source: 'file', url: '' }))).toBe(false);
    submitJob.mockClear();
    expect(await sentCacheable(article('pasted-over', { pastedText: 'full text' }))).toBe(false);
  });
});

describe('downloadChunks when every chunk is ready at once (a job the voice cache served)', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ i, text: `Chunk ${i}.`, sentenceStart: i, sentenceCount: 1, pauseAfter: 0.25 }));

  it('stores chunks in index order, and the first group before it fetches the rest, so playback can start early', async () => {
    const a = article('cached', { chunks: ten, serverJob: 'job-1' });
    fake.rows.set(a.id, { ...a });
    const events: string[] = [];
    server.jobStatus.mockResolvedValue({ status: 'complete', ready: ten.map((c) => ({ i: c.i, sec: 1 })) });
    // Later chunks answer first, to prove order doesn't depend on who finishes first.
    server.fetchChunkBytes.mockImplementation(async (_s: unknown, _job: string, i: number) => {
      events.push(`fetch ${i}`);
      await new Promise((r) => setTimeout(r, 10 - i));
      return new ArrayBuffer(i);
    });
    const stored: number[] = [];
    await downloadChunks(a, {
      isCancelled: () => false,
      shouldStop: () => false,
      onChunk: async (i) => {
        events.push(`store ${i}`);
        stored.push(i);
      },
    });
    expect(stored).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(events.indexOf('store 0')).toBeLessThan(events.indexOf('fetch 4'));
    expect(events.indexOf('store 3')).toBeLessThan(events.indexOf('fetch 4'));
  });
});
