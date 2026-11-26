import { useState } from 'react';
import type { Feed, FeedItem } from '../db';
import { useAppData } from '../app/data';
import { openSheet, showSnack } from '../app/ui';
import { ago, shortDate } from '../feeds/format';
import { addFeedItem, checkFeeds, removeFeed } from '../feeds/store';
import { Icon } from '../ui/Icon';
import { Dock } from './TabBar';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Subscriptions tab (SPEC §4 "Feed inbox"): new posts from the blogs you follow, and the list
 * of blogs. Nothing here is added to the queue until you tap Add.
 */
export function Subscriptions() {
  const { feeds, feedItems, online } = useAppData();
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const byFeed = new Map(feeds.map((f) => [f.id, f]));
  const lastChecked = Math.max(0, ...feeds.map((f) => f.lastCheckedAt ?? 0));

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

  const remove = async (feed: Feed) => {
    const undo = await removeFeed(feed);
    showSnack({ text: `Removed ${feed.title}`, actions: [{ label: 'Undo', run: undo }] });
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
            <button className="icon-btn accent" aria-label="Subscribe to a blog" onClick={() => openSheet({ kind: 'subscribe' })}>
              <Icon name="add" stroke={2} />
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
          <p>Paste a blog’s address to see its new posts here.</p>
          <button className="text-btn" style={{ marginTop: 12 }} onClick={() => openSheet({ kind: 'subscribe' })}>
            Subscribe to a blog
          </button>
        </div>
      ) : (
        <div className="feed-body">
          {feedItems.length > 0 ? (
            <ul className="feed-list" aria-label="New posts">
              {feedItems.map((item) => (
                <li key={item.id} className="row-wrap">
                  <PostRow item={item} feed={byFeed.get(item.feedId)} busy={adding.has(item.id)} onAdd={() => void add(item)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="feed-none">No posts yet.</p>
          )}

          <h2 className="q-section feed-head">Your subscriptions</h2>
          <ul className="feed-list" aria-label="Your subscriptions">
            {feeds.map((f) => (
              <li key={f.id} className="feed-sub">
                <div className="row-main">
                  <p className="row-title">{f.title}</p>
                  <p className="row-meta">
                    <span className="segs">{f.siteUrl ? f.siteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : f.feedUrl.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  </p>
                  {f.lastError && (
                    <p className="row-meta">
                      <Icon name="warn" size={16} className="glyph" />
                      <span className="segs">Couldn’t check. {f.lastError}</span>
                    </p>
                  )}
                </div>
                <button className="text-btn danger" aria-label={`Remove ${f.title}`} onClick={() => void remove(f)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dock />
    </div>
  );
}

function PostRow({ item, feed, busy, onAdd }: { item: FeedItem; feed?: Feed; busy: boolean; onAdd: () => void }) {
  const unread = item.seenAt === null;
  const added = !!item.articleId;
  return (
    <div className={`row feed-row${unread ? ' unread' : ''}`}>
      <div className="row-main">
        <p className="row-title">{item.title}</p>
        <p className="row-meta">
          {unread && <span className="new-dot" aria-hidden="true" />}
          <span className="segs">
            {unread && <span className="sr-only">New. </span>}
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
