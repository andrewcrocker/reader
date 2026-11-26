import { useMemo, useState } from 'react';
import type { Feed, FeedItem } from '../db';
import { useAppData } from '../app/data';
import { openManage, showSnack } from '../app/ui';
import { recentIds } from '../feeds/diff';
import { ago, shortDate } from '../feeds/format';
import { addFeedItem, checkFeeds } from '../feeds/store';
import { Icon } from '../ui/Icon';
import { Dock } from './TabBar';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Subscriptions tab (SPEC §4b): new posts from the blogs you follow. Subscribing, the list of
 * blogs and removing one are on Your subscriptions (Manage). Nothing here is added to the queue until you tap Add.
 */
export function Subscriptions() {
  const { feeds, feedItems, online } = useAppData();
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const byFeed = new Map(feeds.map((f) => [f.id, f]));
  const recent = useMemo(() => recentIds(feedItems), [feedItems]);
  const lastChecked = Math.max(0, ...feeds.map((f) => f.lastCheckedAt ?? 0));
  const failing = feeds.filter((f) => f.lastError).length;

  const checkNow = async () => {
    setChecking(true);
    const r = await checkFeeds({ force: true });
    setChecking(false);
    showSnack({ text: r.failed && !r.added ? 'Couldn’t check some blogs' : r.added ? plural(r.added, 'new post') : 'No new posts' });
  };

  const add = async (item: FeedItem) => {
    if (adding.has(item.id)) return;
    setAdding((s) => new Set(s).add(item.id));
    const { existed } = await addFeedItem(item);
    setAdding((s) => {
      const n = new Set(s);
      n.delete(item.id);
      return n;
    });
    showSnack({ text: existed ? 'Already in your queue' : 'Saved to your queue' });
  };

  return (
    <div className="screen">
      <header className="q-header">
        <div className="q-header-row">
          <div style={{ minWidth: 0 }}>
            <h1 className="screen-title">Subscriptions</h1>
            {lastChecked > 0 && <p className="q-sub">Checked {ago(lastChecked)}</p>}
          </div>
          <div className="q-actions">
            {feeds.length > 0 && (
              <button className="icon-btn" aria-label={online ? 'Check now' : 'Check now, unavailable offline'} aria-busy={checking} disabled={checking || !online} onClick={() => void checkNow()}>
                <Icon name={online ? 'retry' : 'cloud-off'} />
              </button>
            )}
            <button className="icon-btn" aria-label="Manage subscriptions" onClick={openManage}>
              <Icon name="manage" />
            </button>
          </div>
        </div>
      </header>

      {feeds.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="rss" size={36} />
          </div>
          <h2>No subscriptions yet</h2>
          <p>New posts from the blogs you follow show up here.</p>
          <button className="btn outline" style={{ marginTop: 20 }} onClick={openManage}>
            Add a blog
          </button>
        </div>
      ) : (
        <div className="feed-body">
          {failing > 0 && (
            <button className="feed-issue" onClick={openManage}>
              <Icon name="warn" size={16} className="glyph" />
              {plural(failing, 'blog')} couldn’t be checked
              <Icon name="chevron-right" size={18} className="chev" />
            </button>
          )}
          {feedItems.length > 0 ? (
            <ul className="feed-list" aria-label="Posts">
              {feedItems.map((item) => (
                <li key={item.id} className="row-wrap">
                  <PostRow item={item} feed={byFeed.get(item.feedId)} recent={recent.has(item.id)} busy={adding.has(item.id)} onAdd={() => void add(item)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="feed-none">No posts yet.</p>
          )}
        </div>
      )}

      <Dock />
    </div>
  );
}

function PostRow({ item, feed, recent, busy, onAdd }: { item: FeedItem; feed?: Feed; recent: boolean; busy: boolean; onAdd: () => void }) {
  const unread = item.seenAt === null;
  const added = !!item.articleId;
  return (
    <div className={`row feed-row${unread ? ' unread' : ''}`}>
      <div className="row-main">
        <p className="row-title">{item.title}</p>
        <p className="row-meta">
          <span className="segs">
            {unread && <span className="sr-only">Unread. </span>}
            {recent && (
              <>
                <span className="new-tag">New</span>
                {' · '}
              </>
            )}
            {[feed?.title, shortDate(item.publishedAt ?? item.firstSeenAt)].filter(Boolean).join(' · ')}
          </span>
        </p>
      </div>
      {added ? (
        <span className="feed-added">
          <Icon name="check" size={18} /> Added
        </span>
      ) : (
        <button className="text-btn" disabled={busy} aria-label={`Add ${item.title} to your queue`} onClick={onAdd}>
          Add
        </button>
      )}
    </div>
  );
}
