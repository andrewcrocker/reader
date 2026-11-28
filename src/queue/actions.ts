import { db, firstQueueOrder, nextQueueOrder, type Article } from '../db';
import { deleteAudio } from '../audio/storage';
import { addText, addUrl, kick, purgeArticle, rerenderArticle, retryArticle } from '../pipeline/runner';

// Queue CRUD (SPEC §10, §11a). Reversible actions return an `undo` for the snackbar.

export type Undo = () => Promise<void>;

/** Soft delete: hides the rows until the undo window ends, then `purgeDeleted` removes them. */
export async function softDelete(ids: string[]): Promise<Undo> {
  const now = Date.now();
  await db.articles.where('id').anyOf(ids).modify({ deletedAt: now });
  return async () => {
    await db.articles.where('id').anyOf(ids).modify({ deletedAt: undefined });
  };
}

/** Purge soft-deleted rows. With no ids, purges every leftover (run on launch). */
export async function purgeDeleted(ids?: string[]): Promise<void> {
  const rows = ids ? await db.articles.where('id').anyOf(ids).toArray() : await db.articles.toArray();
  for (const a of rows) if (a.deletedAt) await purgeArticle(a.id);
}

/** Mark played: moves the rows to Played (stored as `archivedAt`). Undo restores what each row had before. */
export async function markPlayed(ids: string[]): Promise<Undo> {
  const before = await db.articles.where('id').anyOf(ids).toArray();
  const now = Date.now();
  await db.articles.where('id').anyOf(ids).modify((a) => {
    a.playedAt = now;
    a.archivedAt = now;
    a.positionSec = 0;
  });
  return async () => {
    await db.transaction('rw', db.articles, async () => {
      for (const a of before) await db.articles.update(a.id, { playedAt: a.playedAt, archivedAt: a.archivedAt, positionSec: a.positionSec });
    });
  };
}

/** Love or unlove. Loved means "worth revisiting or sharing"; it's independent of Archive, which only means done. */
export async function setLoved(id: string, loved: boolean): Promise<void> {
  await db.articles.update(id, { lovedAt: loved ? Date.now() : undefined });
}

/** Move to the top of Up next, keeping the rows' relative order. Archived rows come back out. */
export async function moveToTop(ids: string[]): Promise<Undo> {
  const rows = (await db.articles.where('id').anyOf(ids).toArray()).sort((a, b) => a.queueOrder - b.queueOrder);
  const top = await firstQueueOrder();
  await db.transaction('rw', db.articles, async () => {
    for (const [i, a] of rows.entries()) await db.articles.update(a.id, { queueOrder: top - rows.length + 1 + i, archivedAt: undefined });
  });
  void kick();
  return async () => {
    await db.transaction('rw', db.articles, async () => {
      for (const a of rows) await db.articles.update(a.id, { queueOrder: a.queueOrder, archivedAt: a.archivedAt });
    });
  };
}

/** Add to queue, from Played: back to the end of Up next, in the order given. Audio that was cleared is made again. */
export async function requeue(ids: string[]): Promise<Undo> {
  const rows = (await db.articles.where('id').anyOf(ids).toArray()).filter((a) => a.archivedAt);
  const end = await nextQueueOrder();
  await db.transaction('rw', db.articles, async () => {
    for (const [i, a] of rows.entries()) await db.articles.update(a.id, { queueOrder: end + i, archivedAt: undefined });
  });
  void kick();
  return async () => {
    await db.transaction('rw', db.articles, async () => {
      for (const a of rows) await db.articles.update(a.id, { queueOrder: a.queueOrder, archivedAt: a.archivedAt });
    });
  };
}

/** A `queueOrder` strictly between two neighbors (either may be missing at the ends). */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** Where `id` lands when moved to index `to` of `ids` (Up next, in order): the new order and its neighbors. */
export function placeAt(ids: string[], id: string, to: number): { order: string[]; before?: string; after?: string } {
  const rest = ids.filter((x) => x !== id);
  const i = Math.max(0, Math.min(to, rest.length));
  return { order: [...rest.slice(0, i), id, ...rest.slice(i)], before: rest[i - 1], after: rest[i] };
}

/** Drag reorder: place `id` between the rows now above and below it. */
export async function reorder(id: string, beforeId: string | undefined, afterId: string | undefined): Promise<void> {
  await db.transaction('rw', db.articles, async () => {
    const pick = () => Promise.all([beforeId ? db.articles.get(beforeId) : undefined, afterId ? db.articles.get(afterId) : undefined]);
    let [before, after] = await pick();
    let q = orderBetween(before?.queueOrder, after?.queueOrder);
    // Halving runs out of precision after many moves into the same gap: renumber everything and try again.
    if (before && after && !(q > before.queueOrder && q < after.queueOrder)) {
      const all = await db.articles.orderBy('queueOrder').toArray();
      for (const [i, a] of all.entries()) await db.articles.update(a.id, { queueOrder: i + 1 });
      [before, after] = await pick();
      q = orderBetween(before?.queueOrder, after?.queueOrder);
    }
    await db.articles.update(id, { queueOrder: q });
  });
  void kick();
}

/** Move up/down by one place in Up next (`ids`, in order). The row menu and the keyboard use this. */
export async function moveBy(ids: string[], id: string, delta: number): Promise<boolean> {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || delta === 0 || to < 0 || to >= ids.length) return false;
  const { before, after } = placeAt(ids, id, to);
  await reorder(id, before, after);
  return true;
}

/** Can this row's audio be made again (it has text to speak)? */
export const isRenderable = (a: Article) => !!a.chunks?.length;

/** Does Refresh do anything for this row? A failed one is tried again; one with text gets its audio made again. */
export const isRefreshable = (a: Article) => a.status === 'failed' || isRenderable(a);

/**
 * Refresh (multi-select): one action for "this didn't work" and "make this again". A failed article is
 * tried again from where it stopped. Any other gets its audio made again in the current voice, keeping
 * its text and position. Returns how many of each, for the snackbar.
 */
export async function refreshMany(ids: string[]): Promise<{ retried: number; rerendered: number }> {
  const rows = await db.articles.where('id').anyOf(ids).toArray();
  let retried = 0;
  let rerendered = 0;
  for (const a of rows) {
    if (a.status === 'failed') {
      await retryArticle(a.id);
      retried++;
    } else if (isRenderable(a)) {
      await rerenderArticle(a.id);
      rerendered++;
    }
  }
  return { retried, rerendered };
}

/** "Clear all articles…" in Settings (confirmed there). */
export async function clearAll(): Promise<void> {
  const ids = await db.articles.toCollection().primaryKeys();
  for (const id of ids) await purgeArticle(id);
}

/** Space "Delete audio for archived articles" would free. */
export async function archivedAudioBytes(): Promise<number> {
  let n = 0;
  await db.articles.filter((a) => !!a.archivedAt && !!a.audioKey).each((a) => (n += a.audioBytes ?? 0));
  return n;
}

/** Delete audio for archived articles, keeping text. They re-render if they come back to Up next. */
export async function deleteArchivedAudio(): Promise<number> {
  const rows = await db.articles.filter((a) => !!a.archivedAt && !!a.audioKey).toArray();
  let freed = 0;
  for (const a of rows) {
    await deleteAudio(a.audioKey!);
    await db.renderedChunks.where('articleId').equals(a.id).delete();
    await db.articles.update(a.id, { audioKey: undefined, audioBytes: undefined, status: 'extracted', renderProgress: 0 });
    freed += a.audioBytes ?? 0;
  }
  return freed;
}

// ---- Export / import (SPEC §11a): URLs and pasted text, titles, order, positions, archive state ----

export interface ExportItem {
  source: 'url' | 'text';
  url?: string;
  text?: string;
  title: string;
  savedAt: number;
  queueOrder: number;
  positionSec: number;
  playedAt?: number;
  archivedAt?: number;
  lovedAt?: number;
}

export interface ExportFile {
  app: 'read-aloud';
  version: 1;
  exportedAt: number;
  articles: ExportItem[];
}

export function toExportItem(a: Article): ExportItem | null {
  if (a.deletedAt) return null;
  // An uploaded PDF has no link to go back to: it travels as its extracted text.
  const text = a.source === 'text' ? a.pastedText : a.source === 'file' ? a.sentences.map((s) => s.text).join(' ') : undefined;
  if (a.source === 'url' ? !a.url : !text) return null;
  return {
    source: a.source === 'url' ? 'url' : 'text',
    ...(a.source === 'url' ? { url: a.url } : { text }),
    title: a.title,
    savedAt: a.savedAt,
    queueOrder: a.queueOrder,
    positionSec: a.positionSec,
    playedAt: a.playedAt,
    archivedAt: a.archivedAt,
    lovedAt: a.lovedAt,
  };
}

export async function exportQueue(): Promise<Blob> {
  const rows = await db.articles.orderBy('queueOrder').toArray();
  const file: ExportFile = { app: 'read-aloud', version: 1, exportedAt: Date.now(), articles: rows.map(toExportItem).filter((x) => x !== null) };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

/** Validate an export file. Throws a user-facing message if it isn't one. */
export function parseExport(json: string): ExportItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t a queue export.');
  }
  const f = data as Partial<ExportFile>;
  if (f?.app !== 'read-aloud' || !Array.isArray(f.articles)) throw new Error('That file isn’t a queue export.');
  return f.articles.filter(
    (x): x is ExportItem =>
      !!x &&
      typeof x.title === 'string' &&
      ((x.source === 'url' && typeof x.url === 'string' && /^https?:\/\//.test(x.url)) || (x.source === 'text' && typeof x.text === 'string' && !!x.text.trim())),
  );
}

/** Import after what's there, skipping links already in the queue. Returns how many were added. */
export async function importQueue(json: string): Promise<number> {
  const items = parseExport(json).sort((a, b) => a.queueOrder - b.queueOrder);
  const existing = new Set((await db.articles.toArray()).map((a) => a.url).filter(Boolean));
  let order = await nextQueueOrder();
  let added = 0;
  for (const x of items) {
    if (x.source === 'url' && existing.has(x.url!)) continue;
    const id = x.source === 'url' ? await addUrl(x.url!, x.title) : await addText(x.text!, x.title);
    await db.articles.update(id, { queueOrder: order++, savedAt: x.savedAt, positionSec: x.positionSec ?? 0, playedAt: x.playedAt, archivedAt: x.archivedAt, lovedAt: typeof x.lovedAt === 'number' ? x.lovedAt : undefined });
    added++;
  }
  void kick();
  return added;
}
