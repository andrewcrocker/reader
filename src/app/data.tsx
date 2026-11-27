import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS, getSettings, type Article, type Feed, type FeedItem, type Settings } from '../db';
import { inboxOrder } from '../feeds/diff';

// Live queue + settings, read once at the root and shared by every screen.

interface AppData {
  loaded: boolean;
  articles: Article[];
  /** Up next in queue order (not archived or deleted). */
  upNext: Article[];
  /** Everything archived, most recently played first. The Saved tab shows the ones that aren't loved. */
  archive: Article[];
  /** Loved articles, newest love first, archived or not. The top of the Saved tab. */
  loved: Article[];
  feeds: Feed[];
  /** Posts from every feed, newest first. */
  feedItems: FeedItem[];
  /** Any post the user hasn't seen: lights the dot on the Subscriptions tab. */
  hasNewPosts: boolean;
  settings: Settings;
  online: boolean;
}

const Ctx = createContext<AppData | null>(null);

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const articles = useLiveQuery(() => db.articles.orderBy('queueOrder').toArray(), []);
  const settings = useLiveQuery(() => getSettings(), []);
  const feeds = useLiveQuery(() => db.feeds.toArray(), []);
  const feedItems = useLiveQuery(() => db.feedItems.toArray(), []);
  const online = useOnline();
  const value = useMemo<AppData>(() => {
    const all = articles ?? [];
    const live = all.filter((a) => !a.deletedAt);
    return {
      loaded: articles !== undefined && settings !== undefined,
      articles: all,
      upNext: live.filter((a) => !a.archivedAt),
      archive: live.filter((a) => a.archivedAt).sort((a, b) => b.archivedAt! - a.archivedAt!),
      loved: live.filter((a) => a.lovedAt).sort((a, b) => b.lovedAt! - a.lovedAt!),
      feeds: [...(feeds ?? [])].sort((a, b) => a.addedAt - b.addedAt),
      feedItems: inboxOrder(feedItems ?? []),
      hasNewPosts: (feedItems ?? []).some((i) => i.seenAt === null),
      settings: settings ?? DEFAULT_SETTINGS,
      online,
    };
  }, [articles, feeds, feedItems, settings, online]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside AppDataProvider');
  return v;
}
