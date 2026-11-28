import type { Article, Feed, FeedItem } from '../db';

// The list of blogs on Subscriptions (DESIGN §10): what each row counts and how the rows are ordered.
// Pure, so it's testable without IndexedDB.

export type FeedSort = 'recent' | 'alpha';

export interface FeedSummary {
  feed: Feed;
  /** Posts the user hasn't seen: the row's dot and its count. */
  unseen: number;
  /** When the blog last posted (publish date, else when we first saw the post). Undefined with no posts. */
  latest?: number;
}

const when = (i: Pick<FeedItem, 'publishedAt' | 'firstSeenAt'>) => i.publishedAt ?? i.firstSeenAt;

/** Sorts by name the way a person would: no leading "The", case and accents ignored. */
const nameKey = (title: string) => title.replace(/^(the|a|an)\s+/i, '').trim();

/**
 * One summary per blog, in `sort` order. 'recent': the blog that posted last comes first, and a blog
 * with no posts yet goes by when it was added. 'alpha': by name. Ties fall back to the name, then the
 * id, so the order never jumps between renders.
 */
export function summarizeFeeds(feeds: Feed[], items: Pick<FeedItem, 'feedId' | 'publishedAt' | 'firstSeenAt' | 'seenAt'>[], sort: FeedSort): FeedSummary[] {
  const by = new Map<string, { unseen: number; latest?: number }>();
  for (const it of items) {
    const s = by.get(it.feedId) ?? { unseen: 0 };
    if (it.seenAt === null) s.unseen++;
    s.latest = Math.max(s.latest ?? -Infinity, when(it));
    by.set(it.feedId, s);
  }
  const rows: FeedSummary[] = feeds.map((feed) => ({ feed, unseen: by.get(feed.id)?.unseen ?? 0, latest: by.get(feed.id)?.latest }));
  const byName = (a: FeedSummary, b: FeedSummary) => nameKey(a.feed.title).localeCompare(nameKey(b.feed.title), undefined, { sensitivity: 'base' }) || a.feed.id.localeCompare(b.feed.id);
  const recency = (r: FeedSummary) => r.latest ?? r.feed.addedAt;
  return rows.sort(sort === 'alpha' ? byName : (a, b) => recency(b) - recency(a) || byName(a, b));
}

// ---- One blog's posts: what each post's article has been through, and the Show filter ----

export type PostShow = 'unplayed' | 'played' | 'favorites' | 'all';

export interface PostState {
  /** In the queue or the archive right now: the row shows the check instead of Add. */
  added: boolean;
  /** Listened to. A post whose article was added and is gone (deleted, or cleared after playing) counts too: it has been dealt with. */
  played: boolean;
  favorite: boolean;
}

type ArticleLike = Pick<Article, 'playedAt' | 'archivedAt' | 'lovedAt' | 'deletedAt'>;

/** A post's state, from the article made from it (if any). A post never added is unplayed. */
export function postState(item: Pick<FeedItem, 'articleId'>, articles: ReadonlyMap<string, ArticleLike>): PostState {
  if (!item.articleId) return { added: false, played: false, favorite: false };
  const a = articles.get(item.articleId);
  if (!a || a.deletedAt) return { added: false, played: true, favorite: false };
  return { added: true, played: !!(a.playedAt || a.archivedAt), favorite: !!a.lovedAt };
}

/** Whether a post belongs in the chosen view. Unplayed and Played split every post between them. */
export function showsPost(state: PostState, show: PostShow): boolean {
  if (show === 'unplayed') return !state.played;
  if (show === 'played') return state.played;
  if (show === 'favorites') return state.favorite;
  return true;
}
