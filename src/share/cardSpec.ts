import { db, type Article } from '../db';
import type { CardItem, CardSpec } from './card';
import { RANGE_LABEL, toShareItem, type ShareRange } from './lists';

/** The card shows the first article as "now playing" and up to three after it, then "+ N more". It lays out as many of these as fit. */
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

/** What the card draws for `list` (the articles that are going in the link, newest love first) under `headline`. */
export async function cardSpec(list: Article[], headline: string, range: ShareRange): Promise<CardSpec> {
  const items: CardItem[] = await Promise.all(
    list.slice(0, CARD_ROWS).map(async (a) => {
      const it = toShareItem(a);
      return { title: it.title, domain: it.domain, tint: it.tint ?? '#3f4c4a', minutes: it.minutes, art: await loadArt(a) };
    }),
  );
  return { headline, rangeLabel: RANGE_LABEL[range], total: list.length, items };
}
