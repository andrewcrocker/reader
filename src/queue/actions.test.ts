import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, firstQueueOrder: vi.fn(), nextQueueOrder: vi.fn() }));
vi.mock('../audio/storage', () => ({ deleteAudio: vi.fn() }));
vi.mock('../pipeline/runner', () => ({}));

const { orderBetween, parseExport, toExportItem } = await import('./actions');
import type { Article } from '../db';

const base: Article = { id: 'a', source: 'url', url: 'https://x.com/a', title: 'A', savedAt: 1, status: 'ready', sentences: [], positionSec: 12, queueOrder: 3 };

describe('orderBetween', () => {
  it('handles both ends and the middle', () => {
    expect(orderBetween(undefined, undefined)).toBe(1);
    expect(orderBetween(undefined, 2)).toBe(1);
    expect(orderBetween(5, undefined)).toBe(6);
    expect(orderBetween(1, 2)).toBe(1.5);
  });
});

describe('export / import', () => {
  it('round-trips links and pasted text, and drops deleted rows', () => {
    const text: Article = { ...base, id: 'b', source: 'text', url: '', pastedText: 'Hello there.', archivedAt: 9 };
    const items = [base, text, { ...base, id: 'c', deletedAt: 5 }].map(toExportItem).filter((x) => x !== null);
    expect(items).toHaveLength(2);
    const json = JSON.stringify({ app: 'read-aloud', version: 1, exportedAt: 0, articles: items });
    const parsed = parseExport(json);
    expect(parsed[0]).toMatchObject({ source: 'url', url: 'https://x.com/a', positionSec: 12 });
    expect(parsed[1]).toMatchObject({ source: 'text', text: 'Hello there.', archivedAt: 9 });
  });

  it('rejects files that are not exports and skips bad rows', () => {
    expect(() => parseExport('nope')).toThrow(/queue export/);
    expect(() => parseExport('{"articles":[]}')).toThrow(/queue export/);
    const json = JSON.stringify({ app: 'read-aloud', articles: [{ source: 'url', url: 'javascript:1', title: 'x' }, { source: 'text', text: ' ', title: 'y' }] });
    expect(parseExport(json)).toEqual([]);
  });
});
