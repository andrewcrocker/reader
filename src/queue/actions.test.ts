import { describe, expect, it, vi } from 'vitest';

// Just enough of Dexie's `articles` table for the reorder actions.
const fake = vi.hoisted(() => {
  const rows = new Map<string, { id: string; queueOrder: number }>();
  const articles = {
    get: async (id: string) => (rows.has(id) ? { ...rows.get(id)! } : undefined),
    update: async (id: string, patch: object) => (rows.has(id) ? (Object.assign(rows.get(id)!, patch), 1) : 0),
    orderBy: () => ({ toArray: async () => [...rows.values()].sort((a, b) => a.queueOrder - b.queueOrder).map((r) => ({ ...r })) }),
  };
  const db = { articles, transaction: async (_m: string, _t: unknown, fn: () => Promise<void>) => fn() };
  const order = () => [...rows.values()].sort((a, b) => a.queueOrder - b.queueOrder).map((r) => r.id);
  const seed = (ids: string[], orders?: number[]) => {
    rows.clear();
    ids.forEach((id, i) => rows.set(id, { id, queueOrder: orders?.[i] ?? i + 1 }));
  };
  return { db, rows, order, seed };
});

vi.mock('../db', () => ({ db: fake.db, firstQueueOrder: vi.fn(), nextQueueOrder: vi.fn() }));
vi.mock('../audio/storage', () => ({ deleteAudio: vi.fn() }));
vi.mock('../pipeline/runner', () => ({ kick: vi.fn() }));

const { moveBy, orderBetween, parseExport, placeAt, reorder, toExportItem } = await import('./actions');
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

describe('placeAt', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves down, up, and clamps to the ends', () => {
    expect(placeAt(ids, 'a', 2)).toEqual({ order: ['b', 'c', 'a', 'd'], before: 'c', after: 'd' });
    expect(placeAt(ids, 'd', 0)).toEqual({ order: ['d', 'a', 'b', 'c'], before: undefined, after: 'a' });
    expect(placeAt(ids, 'b', 99)).toEqual({ order: ['a', 'c', 'd', 'b'], before: 'd', after: undefined });
    expect(placeAt(ids, 'c', 2).order).toEqual(ids);
  });
});

describe('reorder', () => {
  it('drops a row between its new neighbors and persists the order', async () => {
    fake.seed(['a', 'b', 'c', 'd']);
    const { before, after, order } = placeAt(fake.order(), 'a', 2);
    await reorder('a', before, after);
    expect(fake.order()).toEqual(order);
    expect(fake.rows.get('a')!.queueOrder).toBe(3.5);
  });

  it('moves to either end', async () => {
    fake.seed(['a', 'b', 'c']);
    await reorder('c', undefined, 'a');
    expect(fake.order()).toEqual(['c', 'a', 'b']);
    await reorder('c', 'b', undefined);
    expect(fake.order()).toEqual(['a', 'b', 'c']);
  });

  it('renumbers when the gap between neighbors runs out of precision', async () => {
    fake.seed(['a', 'b', 'c'], [1, 1 + Number.EPSILON, 5]);
    await reorder('c', 'a', 'b');
    expect(fake.order()).toEqual(['a', 'c', 'b']);
    expect(fake.rows.get('a')!.queueOrder).toBe(1);
    expect(fake.rows.get('c')!.queueOrder).toBe(1.5);
  });

  it('keeps the order right over many moves into the same gap', async () => {
    fake.seed(['a', 'b', 'x', 'y']);
    for (let i = 0; i < 80; i++) {
      const id = i % 2 ? 'x' : 'y';
      const ids = fake.order();
      const { before, after } = placeAt(ids, id, 1);
      await reorder(id, before, after);
      expect(fake.order()).toEqual(placeAt(ids, id, 1).order);
    }
  });
});

describe('moveBy', () => {
  it('moves one place up or down, and refuses past the ends', async () => {
    fake.seed(['a', 'b', 'c']);
    expect(await moveBy(fake.order(), 'c', -1)).toBe(true);
    expect(fake.order()).toEqual(['a', 'c', 'b']);
    expect(await moveBy(fake.order(), 'a', 1)).toBe(true);
    expect(fake.order()).toEqual(['c', 'a', 'b']);
    expect(await moveBy(fake.order(), 'c', -1)).toBe(false);
    expect(await moveBy(fake.order(), 'b', 1)).toBe(false);
    expect(await moveBy(fake.order(), 'zz', 1)).toBe(false);
    expect(fake.order()).toEqual(['c', 'a', 'b']);
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

  it('keeps which articles are loved', () => {
    const loved = toExportItem({ ...base, lovedAt: 77 });
    expect(loved).toMatchObject({ source: 'url', lovedAt: 77 });
    const json = JSON.stringify({ app: 'read-aloud', version: 1, exportedAt: 0, articles: [loved, toExportItem(base)] });
    expect(parseExport(json).map((x) => x.lovedAt)).toEqual([77, undefined]);
  });

  it('rejects files that are not exports and skips bad rows', () => {
    expect(() => parseExport('nope')).toThrow(/queue export/);
    expect(() => parseExport('{"articles":[]}')).toThrow(/queue export/);
    const json = JSON.stringify({ app: 'read-aloud', articles: [{ source: 'url', url: 'javascript:1', title: 'x' }, { source: 'text', text: ' ', title: 'y' }] });
    expect(parseExport(json)).toEqual([]);
  });
});
