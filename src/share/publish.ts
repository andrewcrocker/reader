import { db, getSettings, type Article, type SharedList } from '../db';
import { noteInviteRejected } from '../app/invite';
import type { CardItem, CardSpec } from './card';
import { headline, listArticles, MAX_ITEMS, publishRequest, RANGE_LABEL, toShareItem, type ShareRange } from './lists';

// The client half of publishing a list (spec/SHARING.md): build the card, send it with the snapshot,
// keep a receipt, hand the link to the system share sheet.

/** The card shows the first article as "now playing" and a few after it (the Worker's page shows them all). It lays out as many of these as fit. */
const CARD_ROWS = 4;

/** The site or article art for an article's tile, decoded; undefined when it has none (the tile is then the tint and initials). */
async function loadArt(a: Article): Promise<ImageBitmap | undefined> {
  const key = a.siteArtKey ?? a.articleArtKey;
  if (!key) return undefined;
  try {
    const row = await db.art.get(key);
    return row ? await createImageBitmap(row.blob) : undefined;
  } catch {
    return undefined;
  }
}

/** What the card draws for this list and sender name. Pass `withArt: false` to skip the artwork (a smaller PNG). */
export async function cardSpec(articles: Article[], range: ShareRange, name: string, withArt = true): Promise<CardSpec> {
  const list = listArticles(articles, range).slice(0, MAX_ITEMS);
  const items: CardItem[] = await Promise.all(
    list.slice(0, CARD_ROWS).map(async (a) => {
      const it = toShareItem(a);
      return { title: it.title, domain: it.domain, tint: it.tint ?? '#3f4c4a', minutes: it.minutes, art: withArt ? await loadArt(a) : undefined };
    }),
  );
  // The whole list's listening time, not just the rows the card has room for.
  const totalMinutes = list.reduce((sum, a) => sum + (toShareItem(a).minutes ?? 0), 0);
  return { headline: headline(name.trim().slice(0, 40), range), rangeLabel: RANGE_LABEL[range], total: list.length, totalMinutes: totalMinutes || undefined, items };
}

export class PublishError extends Error {}

/** Sends the snapshot and its card; remembers it locally. Throws `PublishError` with a message fit for the sheet. */
export async function publishList(articles: Article[], range: ShareRange, name: string, note: string, card: Blob): Promise<SharedList> {
  const s = await getSettings();
  const meta = publishRequest(articles, range, name, note);
  if (!meta.items.length) throw new PublishError('There’s nothing in that range to share.');
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  form.set('card', card, 'card.png');
  let res: Response;
  try {
    res = await fetch(`${s.proxyUrl.replace(/\/$/, '')}/lists`, { method: 'POST', headers: { 'X-App-Secret': s.proxySecret }, body: form });
  } catch {
    throw new PublishError('Couldn’t reach the server. Check your connection and try again.');
  }
  if (res.status === 401) {
    noteInviteRejected();
    throw new PublishError('The server didn’t accept this invite.');
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!res.ok || !body.id || !body.url) {
    throw new PublishError(res.status === 413 ? 'That list is too big to share.' : `Couldn’t publish the list (${body.error ?? res.status}).`);
  }
  const record: SharedList = { id: body.id, url: body.url, range, title: meta.title, count: meta.items.length, createdAt: Date.now() };
  await db.sharedLists.put(record);
  return record;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed';

/** The system share sheet where there is one; otherwise (or if it can't open) the link goes on the clipboard. */
export async function shareLink(url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (e) {
      // Closing the sheet is a choice, not a failure.
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  return copyLink(url);
}

export async function copyLink(url: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
