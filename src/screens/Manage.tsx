import { useEffect, useRef, useState } from 'react';
import type { Feed } from '../db';
import { useAppData } from '../app/data';
import { back, showSnack } from '../app/ui';
import { FeedError } from '../feeds/discover';
import { ago, feedHost } from '../feeds/format';
import { removeFeed, subscribe } from '../feeds/store';
import { ExtractError } from '../pipeline/extract';
import { Icon } from '../ui/Icon';
import { Snackbar } from '../ui/Snackbar';
import { MiniPlayer } from './MiniPlayer';

/**
 * Your subscriptions (SPEC §4c): a full screen pushed from the Subscriptions header, the way
 * Settings is pushed from Up next. Subscribe at the top, then the blogs you follow, each with Remove.
 */
export function Manage() {
  const { feeds } = useAppData();
  const title = useRef<HTMLHeadingElement>(null);
  // Focus moves to the heading for screen readers, as on a Settings page.
  useEffect(() => {
    window.scrollTo(0, 0);
    title.current?.focus();
  }, []);

  const remove = async (feed: Feed) => {
    const undo = await removeFeed(feed);
    showSnack({ text: `Removed ${feed.title}`, actions: [{ label: 'Undo', run: undo }] });
  };

  // Newest first, so a blog you just added appears right under the field.
  const list = [...feeds].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="screen">
      <div className="s-header">
        <button className="icon-btn" aria-label="Back to subscriptions" onClick={back}>
          <Icon name="back" />
        </button>
        <h1 tabIndex={-1} ref={title}>
          Your subscriptions
        </h1>
      </div>
      <div className="s-body">
        <SubscribeForm />
        {list.length === 0 ? (
          <p className="manage-none">No subscriptions yet. Paste a blog’s address above.</p>
        ) : (
          <ul className="manage-list" aria-label="Your subscriptions">
            {list.map((f) => (
              <li key={f.id} className="manage-row">
                <div className="row-main">
                  <p className="row-title">{f.title}</p>
                  <p className="row-meta">
                    <span className="segs">{[feedHost(f), f.lastCheckedAt ? `Checked ${ago(f.lastCheckedAt)}` : null].filter(Boolean).join(' · ')}</span>
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
        )}
      </div>
      <div className="dock">
        <Snackbar />
        <MiniPlayer />
      </div>
    </div>
  );
}

/** One field for a blog's address, or its feed's. The posts already on the blog count as seen. */
function SubscribeForm() {
  const { online } = useAppData();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    if (busy || !typed.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const feed = await subscribe(typed);
      // The blog shows in the list below; the snackbar says it was added.
      setTyped('');
      showSnack({ text: `Subscribed to ${feed.title}` });
    } catch (e) {
      setError(e instanceof FeedError || e instanceof ExtractError ? e.message : 'Couldn’t subscribe. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manage-add">
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="feed-input">Blog address</label>
        <div className="input-row">
          <input
            id="feed-input"
            className="input"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          <button className="btn primary" type="submit" disabled={busy || !typed.trim() || !online}>
            {busy ? 'Looking…' : 'Subscribe'}
          </button>
        </div>
      </form>
      {!online && (
        <p className="status-note" role="status">
          <Icon name="cloud-off" size={18} />
          You’re offline. Try again when you’re back online.
        </p>
      )}
      {error && (
        <p className="status-note" role="alert">
          <Icon name="warn" size={18} />
          {error}
        </p>
      )}
      <p className="hint">Paste a blog’s address, or its feed address. New posts show up in Subscriptions, and you pick which ones to add.</p>
    </div>
  );
}
