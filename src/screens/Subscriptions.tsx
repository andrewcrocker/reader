import { useEffect, useMemo, useRef, useState } from 'react';
import { updateSettings, type Feed, type FeedItem } from '../db';
import { useAppData } from '../app/data';
import { back, getUi, openFeed, openSheet, showSnack } from '../app/ui';
import { initials } from '../art/art';
import { useArtUrl } from '../art/useArtUrl';
import { plural } from '../format';
import { inboxOrder } from '../feeds/diff';
import { ago, feedHost, shortDate } from '../feeds/format';
import { summarizeFeeds, type FeedSort, type FeedSummary } from '../feeds/list';
import { addFeedItem, checkFeeds, markFeedSeen, refreshFeed, removeFeed } from '../feeds/store';
import { coverInk, domainColor } from '../theme/color';
import { Icon } from '../ui/Icon';
import { MenuButton } from '../ui/Menu';
import { Dock } from './TabBar';

/**
 * The Subscriptions tab (SPEC §4c, DESIGN §10): the blogs you follow, each with how many posts are new.
 * A blog opens its posts (`FeedPosts`), where you pick which ones to add. Nothing is added to the
 * queue by itself.
 */
export function Subscriptions() {
  const { feeds, feedItems, settings, online } = useAppData();
  const sort: FeedSort = settings.feedSort ?? 'recent';
  const rows = useMemo(() => summarizeFeeds(feeds, feedItems, sort), [feeds, feedItems, sort]);
  const lastChecked = Math.max(0, ...feeds.map((f) => f.lastCheckedAt ?? 0));
  const add = () => openSheet({ kind: 'subscribe' });

  const refreshAll = async () => {
    if (!online) return showSnack({ text: 'You’re offline. Try again when you’re back online.' });
    showSnack({ text: 'Checking for new posts…' });
    const r = await checkFeeds({ force: true });
    showSnack({ text: r.failed && !r.added ? 'Couldn’t check some blogs' : r.added ? plural(r.added, 'new post') : 'No new posts' });
  };

  const refreshOne = async (feed: Feed) => {
    if (!online) return showSnack({ text: 'You’re offline. Try again when you’re back online.' });
    const added = await refreshFeed(feed.id);
    showSnack({ text: added === null ? `Couldn’t check ${feed.title}` : added ? `${plural(added, 'new post')} from ${feed.title}` : `No new posts from ${feed.title}` });
  };

  const remove = async (feed: Feed) => {
    const undo = await removeFeed(feed);
    showSnack({ text: `Deleted ${feed.title}`, actions: [{ label: 'Undo', run: undo }] });
  };

  return (
    <div className="screen">
      <header className="q-header">
        <div className="q-header-row">
          <div style={{ minWidth: 0 }}>
            <h1 className="screen-title">Subscriptions</h1>
            {feeds.length > 0 && <p className="q-sub">{[plural(feeds.length, 'blog'), lastChecked > 0 ? `Checked ${ago(lastChecked)}` : ''].filter(Boolean).join(' · ')}</p>}
          </div>
          <div className="q-actions">
            {feeds.length > 0 && (
              <MenuButton
                header
                label="More for subscriptions"
                items={[
                  { label: 'Refresh', icon: 'retry', run: () => void refreshAll() },
                  { heading: 'Sort by' },
                  { label: 'Recent', checked: sort === 'recent', run: () => void updateSettings({ feedSort: 'recent' }) },
                  { label: 'Alphabetical', checked: sort === 'alpha', run: () => void updateSettings({ feedSort: 'alpha' }) },
                ]}
              />
            )}
            <button className="icon-btn accent" aria-label="Add a subscription" onClick={add}>
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
          <p>New posts from the blogs you follow show up here.</p>
          <button className="btn outline" style={{ marginTop: 20 }} onClick={add}>
            Add a blog
          </button>
        </div>
      ) : (
        <ul className="feed-list" aria-label="Blogs">
          {rows.map((r) => (
            <li key={r.feed.id} className="row-wrap">
              <BlogRow summary={r} onRefresh={() => void refreshOne(r.feed)} onDelete={() => void remove(r.feed)} />
            </li>
          ))}
        </ul>
      )}

      <Dock />
    </div>
  );
}

/** A blog's picture, or its initials on its own color until (or unless) there is one. */
function FeedArt({ feed }: { feed: Feed }) {
  const url = useArtUrl(feed.artKey || undefined);
  if (url) {
    return (
      <div className="art s44" aria-hidden="true">
        <img src={url} alt="" />
      </div>
    );
  }
  const bg = domainColor(feedHost(feed));
  const mark = initials(feed.title || feedHost(feed));
  return (
    <div className="art s44" aria-hidden="true" style={{ background: bg, color: coverInk(bg), fontSize: mark.length >= 3 ? 13 : mark.length === 2 ? 15 : 18 }}>
      {mark}
    </div>
  );
}

function BlogRow({ summary: { feed, unseen, latest }, onRefresh, onDelete }: { summary: FeedSummary; onRefresh: () => void; onDelete: () => void }) {
  const open = () => openFeed(feed.id);
  return (
    <div className="row blog-row">
      <button className="blog-open" onClick={open} aria-label={`${feed.title}${unseen ? `, ${plural(unseen, 'new post')}` : ''}`}>
        <FeedArt feed={feed} />
        <span className="row-main">
          <span className="row-title one-line">{feed.title}</span>
          <span className="row-meta">
            {unseen > 0 && (
              <span className="new-count">
                <span className="new-dot" aria-hidden="true" />
                {unseen} new
              </span>
            )}
            {feed.lastError ? (
              <>
                <Icon name="warn" size={16} className="glyph" />
                <span className="segs">Couldn’t check. {feed.lastError}</span>
              </>
            ) : (
              latest !== undefined && <span className="segs">{shortDate(latest)}</span>
            )}
          </span>
        </span>
      </button>
      <MenuButton
        label={`More for ${feed.title}`}
        items={[
          { label: 'Refresh', icon: 'retry', run: onRefresh },
          { label: 'Delete', icon: 'trash', danger: true, run: onDelete },
        ]}
      />
      {/* The whole row opens the blog; the chevron is the same action, kept out of the tab order and the accessibility tree. */}
      <button className="icon-btn row-action blog-chevron" tabIndex={-1} aria-hidden="true" onClick={open}>
        <Icon name="chevron-right" />
      </button>
    </div>
  );
}

/**
 * One blog's posts, a level into Subscriptions: the header carries the blog's name and a back arrow.
 * Posts you haven't seen have a dot; they count as seen once you leave (or the app goes to the background).
 */
export function FeedPosts({ feedId }: { feedId: string }) {
  const { feeds, feedItems } = useAppData();
  const feed = feeds.find((f) => f.id === feedId);
  const posts = useMemo(() => inboxOrder(feedItems.filter((i) => i.feedId === feedId)), [feedItems, feedId]);
  // `adding` disables the buttons; `pending` is what a second tap checks, since state only updates after the render.
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());
  const title = useRef<HTMLHeadingElement>(null);

  // Focus moves to the heading for screen readers, as on a Settings page.
  useEffect(() => {
    window.scrollTo(0, 0);
    title.current?.focus();
  }, []);

  // Deleted while open (from another tab, or an undo elsewhere): there is nothing to show.
  const gone = feeds.length > 0 && !feed;
  useEffect(() => {
    if (gone && getUi().feed === feedId) back();
  }, [gone, feedId]);

  // Seen on the way out, not on arrival, or the dots would clear before they could be read.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void markFeedSeen(feedId);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      // Checked a tick later: in development React mounts, unmounts and mounts again, and that isn't leaving.
      setTimeout(() => getUi().feed !== feedId && void markFeedSeen(feedId), 0);
    };
  }, [feedId]);

  const add = async (item: FeedItem) => {
    if (pending.current.has(item.id)) return;
    pending.current.add(item.id);
    setAdding((s) => new Set(s).add(item.id));
    try {
      const { existed } = await addFeedItem(item);
      showSnack({ text: existed ? 'Already in your queue' : 'Saved to your queue' });
    } catch {
      showSnack({ text: 'Couldn’t add that post. Try again.' });
    } finally {
      pending.current.delete(item.id);
      setAdding((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  };

  const unseen = posts.filter((p) => p.seenAt === null).length;
  return (
    <div className="screen">
      <header className="q-header pushed">
        <div className="q-header-row">
          <button className="icon-btn" aria-label="Back to subscriptions" onClick={back}>
            <Icon name="back" />
          </button>
          <div className="pushed-text">
            <h1 className="screen-title" tabIndex={-1} ref={title}>
              {feed?.title}
            </h1>
            {feed && <p className="q-sub">{[unseen ? `${unseen} new` : '', plural(posts.length, 'post'), feed.lastCheckedAt ? `Checked ${ago(feed.lastCheckedAt)}` : ''].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
      </header>

      {posts.length > 0 ? (
        <ul className="feed-list" aria-label="Posts">
          {posts.map((item) => (
            <li key={item.id} className="row-wrap">
              <PostRow item={item} busy={adding.has(item.id)} onAdd={() => void add(item)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="feed-list">
          <p className="feed-none">No posts yet.</p>
        </div>
      )}

      <Dock />
    </div>
  );
}

function PostRow({ item, busy, onAdd }: { item: FeedItem; busy: boolean; onAdd: () => void }) {
  const unseen = item.seenAt === null;
  const added = !!item.articleId;
  return (
    <div className="row post-row">
      {unseen && <span className="new-dot post-dot" aria-hidden="true" />}
      <div className="row-main">
        <p className="row-title">
          {unseen && <span className="sr-only">New. </span>}
          {item.title}
        </p>
        <p className="row-meta">
          <span className="segs">{shortDate(item.publishedAt ?? item.firstSeenAt)}</span>
        </p>
      </div>
      {added ? (
        <span className="icon-btn post-added" role="img" aria-label="Added to your queue">
          <Icon name="check-circle" size={28} />
        </span>
      ) : (
        <button className="icon-btn post-add" disabled={busy} aria-label={`Add ${item.title} to your queue`} onClick={onAdd}>
          <Icon name="add-circle" size={28} stroke={1.6} />
        </button>
      )}
    </div>
  );
}
