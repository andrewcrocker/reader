import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Article } from '../db';
import { useAppData } from '../app/data';
import { plural } from '../format';
import { goToFeed, openNowPlaying, openSettings, openSheet, showSnack, useUi, useWide } from '../app/ui';
import { isPlayable, usePlayer } from '../player/PlayerProvider';
import { displayState, isBusy, queueSummary, rowMeta, voiceReady, type Ctx } from '../queue/display';
import { clearSaved, isRefreshable, isRenderable, markPlayed, moveBy, moveToTop, placeAt, purgeDeleted, refreshMany, reorder, requeue, setLoved, softDelete } from '../queue/actions';
import { retryArticle } from '../pipeline/runner';
import { updateSettings } from '../db';
import { Icon } from '../ui/Icon';
import { MenuButton } from '../ui/Menu';
import { Snackbar } from '../ui/Snackbar';
import { isShareable } from '../share/lists';
import { MiniPlayer } from './MiniPlayer';
import { QueueRow } from './QueueRow';
import { TabBar } from './TabBar';
import { useDragReorder } from './useDragReorder';

export function deleteWithUndo(ids: string[]) {
  void softDelete(ids).then((undo) =>
    showSnack({
      text: ids.length === 1 ? 'Article deleted' : `${plural(ids.length, 'article')} deleted`,
      actions: [{ label: 'Undo', run: undo }],
      onDone: () => void purgeDeleted(ids),
    }),
  );
}

export function markPlayedWithUndo(ids: string[]) {
  void markPlayed(ids).then((undo) =>
    showSnack({ text: ids.length === 1 ? 'Marked as played' : `${plural(ids.length, 'article')} marked as played`, actions: [{ label: 'Undo', run: undo }] }),
  );
}

/** Add to queue, from Played: back to the end of Up next. */
export function requeueWithUndo(ids: string[]) {
  void requeue(ids).then((undo) => showSnack({ text: ids.length === 1 ? 'Added to Up next' : `${plural(ids.length, 'article')} added to Up next`, actions: [{ label: 'Undo', run: undo }] }));
}

export function Queue() {
  return <QueueView view="queue" />;
}

/** The Saved tab: what you loved, pinned at the top, and below it what you've finished. Same rows and actions as Up next, minus reordering. */
export function Saved() {
  return <QueueView view="saved" />;
}

function QueueView({ view }: { view: 'queue' | 'saved' }) {
  const { upNext, archive, loved, settings, online, feedOf } = useAppData();
  const saved = view === 'saved';
  // Saved shows one list at a time, picked from its kebab: what you loved (the default), or what you've finished.
  const savedShow = settings.savedShow ?? 'favorites';
  const savedList = savedShow === 'favorites' ? loved : archive;
  const player = usePlayer();
  const { newId } = useUi();
  const wide = useWide();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const listRef = useRef<HTMLUListElement>(null);

  const ctx: Ctx = { online, currentId: player.current?.id, voiceReady: voiceReady(settings), speed: player.speed };
  const selecting = selected !== null;
  const byId = new Map([...upNext, ...archive].map((a) => [a.id, a]));
  const shownUpNext = preview ? preview.map((id) => byId.get(id)!).filter(Boolean) : upNext;
  // What this tab lists, top to bottom: the rows Select all and Share as list work on.
  const inView = saved ? savedList : upNext;
  const canShare = loved.some(isShareable);

  // Share arrival: scroll the new row into view (DESIGN §6).
  useEffect(() => {
    if (newId) rowEls.current.get(newId)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [newId, upNext.length]);

  // Leave selection mode if everything selected went away.
  useEffect(() => {
    if (!selected) return;
    const live = [...selected].filter((id) => byId.has(id));
    if (live.length !== selected.size) setSelected(live.length ? new Set(live) : null);
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n.size ? n : null;
    });

  const tap = (a: Article) => {
    if (selecting) return toggle(a.id);
    // Settings › Playback › Default view: each article you open starts in the view you chose, whatever the last one was left in.
    const lyricsOn = settings.defaultView === 'read-along';
    if (settings.lyricsOn !== lyricsOn) void updateSettings({ lyricsOn });
    const state = displayState(a, ctx);
    if (state === 'failed') return openSheet({ kind: 'explain', id: a.id });
    if (isPlayable(a)) return player.play(a.id);
    if (a.archivedAt && isRenderable(a)) {
      void moveToTop([a.id]);
      return showSnack({ text: 'Back in Up next. Preparing the audio again.' });
    }
    // The text is in: open it now, so read-along works right away; audio starts once it can.
    if (state === 'rendering' || (state === 'queued' && a.sentences.length)) {
      player.play(a.id);
      return openNowPlaying();
    }
    const why = { queued: 'Audio isn’t ready yet. It’s queued to prepare.', fetching: 'Still fetching this page.', waiting: 'This will fetch when you’re back online.' }[state as string];
    if (why) showSnack({ text: why });
  };

  // ---- Reorder: hold a row (or drag its handle in multi-select) and move it; or Move up/down ----
  const upIds = upNext.map((a) => a.id);
  const drag = useDragReorder({
    ids: upIds,
    rowEls,
    listRef,
    onDrop: (id, to) => {
      const { order, before, after } = placeAt(upIds, id, to);
      // Show the new order now; the live query catches up once it's saved.
      flushSync(() => setPreview(order));
      return reorder(id, before, after).finally(() => setPreview(null));
    },
    onHoldRelease: (id) => setSelected((s) => new Set(s).add(id)),
  });
  const move = (id: string, delta: number) => void moveBy(upIds, id, delta);

  // `inArchive`: the row is played (a right swipe adds it back to the queue instead of marking it played). `dim`: draw it as played. Loved rows aren't dimmed, so the top of Saved stays bright.
  // Only Up next rows can be reordered; in Saved a hold goes straight to multi-select.
  const row = (a: Article, inArchive: boolean, dim = inArchive) => {
    const reorderable = !saved && !inArchive;
    const state = displayState(a, ctx);
    const isNew = a.id === newId;
    const meta = rowMeta(a, state, { ...ctx, isNew });
    const feed = feedOf.get(a.id);
    return (
      <QueueRow
        key={a.id}
        article={a}
        feed={feed}
        meta={meta}
        playing={a.id === player.current?.id}
        played={dim}
        isNew={isNew}
        online={online}
        selecting={selecting}
        selected={!!selected?.has(a.id)}
        lifted={drag.liftedId === a.id}
        onTap={() => tap(a)}
        onLongPress={() => setSelected((s) => new Set(s).add(a.id))}
        onSwipe={(dir) => (dir === 'left' ? deleteWithUndo([a.id]) : inArchive ? requeueWithUndo([a.id]) : markPlayedWithUndo([a.id]))}
        rightSwipe={inArchive ? 'queue' : 'played'}
        onStatus={() => openSheet({ kind: 'explain', id: a.id })}
        onRetry={state === 'failed' ? () => void retryArticle(a.id) : undefined}
        onGrab={reorderable ? (p, phase) => drag.grab(a.id, p, phase) : undefined}
        onMove={reorderable ? (delta) => move(a.id, delta) : undefined}
        menu={[
          // The heart lives here, so a row has one button at the end whatever its width.
          { label: a.lovedAt ? 'Remove from favorites' : 'Add to favorites', icon: a.lovedAt ? ('heart-filled' as const) : ('heart' as const), run: () => void setLoved(a.id, !a.lovedAt) },
          // Reordering by menu is for pointers; on a phone you hold a row and drag it.
          ...(!wide || !reorderable || a.id === upIds[0] ? [] : [{ label: 'Move up', icon: 'arrow-up' as const, run: () => move(a.id, -1) }]),
          ...(!wide || !reorderable || a.id === upIds[upIds.length - 1] ? [] : [{ label: 'Move down', icon: 'arrow-down' as const, run: () => move(a.id, 1) }]),
          inArchive ? { label: 'Add to queue', icon: 'queue' as const, run: () => requeueWithUndo([a.id]) } : { label: 'Mark played', icon: 'mark-played' as const, run: () => markPlayedWithUndo([a.id]) },
          ...(feed ? [{ label: 'Go to subscription', icon: 'rss' as const, run: () => goToFeed(feed.id) }] : []),
          { label: 'Delete', icon: 'trash' as const, danger: true, run: () => deleteWithUndo([a.id]) },
        ]}

        rowRef={(el) => (el ? rowEls.current.set(a.id, el) : rowEls.current.delete(a.id))}
      />
    );
  };

  // Archive isn't listed in Up next, so an Up next with only finished articles is empty; Saved is empty when nothing is loved or archived.
  const empty = saved ? !loved.length && !archive.length : !upNext.length;
  const chosen = [...(selected ?? [])].map((id) => byId.get(id)!).filter(Boolean);
  const done = () => setSelected(null);
  const ids = chosen.map((a) => a.id);

  return (
    <div className="screen">
      {selecting ? (
        <div className="select-bar">
          <button className="icon-btn" aria-label="Exit selection" onClick={done}>
            <Icon name="close" />
          </button>
          <h1 aria-live="polite">{selected.size} selected</h1>
          <button className="icon-btn" aria-label="Share as list" title="Share as list" onClick={() => openSheet({ kind: 'share-list', ids: inView.filter((a) => selected.has(a.id)).map((a) => a.id), onShared: done })}>
            <Icon name="share" />
          </button>
          <button className="text-btn" onClick={() => setSelected(new Set(inView.map((a) => a.id)))}>
            Select all
          </button>
        </div>
      ) : (
        <header className="q-header">
          {/* Buttons sit centered against the title and its summary line together. */}
          <div className="q-header-row">
            <div style={{ minWidth: 0 }}>
              <h1 className="screen-title">{saved ? 'Saved' : 'Up next'}</h1>
              {!empty && <p className="q-sub">{saved ? (savedShow === 'favorites' ? plural(loved.length, 'favorite') : `${archive.length} played`) : queueSummary(upNext, ctx)}</p>}
            </div>
            {saved ? (
              <div className="q-actions">
                <button className="icon-btn" disabled={!canShare} onClick={() => openSheet({ kind: 'share-saved' })} aria-label={canShare ? 'Share loved articles' : 'Share loved articles, love an article first'} title="Share loved articles">
                  <Icon name="share" />
                </button>
                <MenuButton
                  header
                  label="Which articles to show"
                  items={[
                    { heading: 'Show' },
                    { label: 'Favorites', checked: savedShow === 'favorites', run: () => void updateSettings({ savedShow: 'favorites' }) },
                    { label: 'Played', checked: savedShow === 'archived', run: () => void updateSettings({ savedShow: 'archived' }) },
                    ...(loved.length || archive.length ? [{ label: 'Delete all saved…', icon: 'trash' as const, danger: true, separated: true, run: () => setConfirmClear(true) }] : []),
                  ]}
                />
              </div>
            ) : (
              <div className="q-actions">
                <button className="icon-btn" aria-label="Settings" onClick={openSettings}>
                  <Icon name="settings" />
                </button>
                <button className="icon-btn accent" aria-label="Add article" onClick={() => openSheet({ kind: 'add', tab: 'link' })}>
                  <Icon name="add" stroke={2} />
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      {!online ? (
        <div className="offline-banner" role="status">
          <Icon name="cloud-off" size={18} /> Offline · ready articles still play
        </div>
      ) : !saved && upNext.some((a) => isBusy(a)) ? (
        <div className="offline-banner" role="status">
          <Icon name="clock" size={18} /> Voices are busy right now. Your articles will finish later.
        </div>
      ) : null}

      {empty && saved ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="heart" size={36} />
          </div>
          <h2>Nothing saved yet</h2>
          <p>Love an article to keep it here, and share your favorites. Articles you’ve listened to land here too.</p>
        </div>
      ) : empty ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="share" size={36} />
          </div>
          <h2>Nothing queued yet</h2>
          <p>Share an article from any app and it lands here, ready to play.</p>
          <button className="text-btn" style={{ marginTop: 12 }} onClick={() => openSheet({ kind: 'add', tab: 'link' })}>
            or paste a link
          </button>
        </div>
      ) : saved && !savedList.length ? (
        <p className="q-hint q-hint-top">{savedShow === 'favorites' ? 'Add an article to your favorites to keep it here. You can share your favorites.' : 'Articles you’ve listened to land here.'}</p>
      ) : saved ? (
        // Favorites: newest first, played or not, never dimmed. Played: most recently played first.
        <ul className="q-list" aria-label={savedShow === 'favorites' ? 'Favorites' : 'Played'}>
          {savedList.map((a) => (savedShow === 'favorites' ? row(a, !!a.archivedAt, false) : row(a, true)))}
        </ul>
      ) : (
        <ul className="q-list" aria-label="Queue" ref={listRef}>
          {shownUpNext.map((a) => row(a, false))}
        </ul>
      )}

      {confirmClear && (
        <>
          <div className="scrim" style={{ zIndex: 50 }} onClick={() => setConfirmClear(false)} aria-hidden="true" />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-saved-title" aria-describedby="clear-saved-desc">
            <h2 id="clear-saved-title">Delete all saved?</h2>
            <p id="clear-saved-desc">
              This deletes {[loved.length ? plural(loved.length, 'favorite') : '', archive.some((a) => !a.lovedAt) ? plural(archive.filter((a) => !a.lovedAt).length, 'played article') : ''].filter(Boolean).join(' and ')}, with the audio.
              {loved.some((a) => !a.archivedAt) ? ' Favorites still in Up next are deleted too.' : ''} It can’t be undone.
            </p>
            <div className="actions">
              <button className="text-btn" autoFocus onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                className="text-btn danger"
                onClick={() => {
                  setConfirmClear(false);
                  void clearSaved().then((n) => showSnack({ text: `${plural(n, 'article')} deleted` }));
                }}
              >
                Delete all
              </button>
            </div>
          </div>
        </>
      )}

      {/* The tab bar goes in the dock under the mini player, and gives way to the action bar while selecting. */}
      <div className={selecting ? 'dock' : 'dock has-tabs'}>
        <Snackbar />
        {selecting ? (
          <div className="action-bar" role="toolbar" aria-label="Selected articles">
            <button className="danger" onClick={() => (deleteWithUndo(ids), done())}>
              <Icon name="trash" />
              Delete
            </button>
            <button onClick={() => void moveToTop(ids).then((undo) => (done(), showSnack({ text: 'Moved to the top', actions: [{ label: 'Undo', run: undo }] })))}>
              <Icon name="move-top" />
              Move to top
            </button>
            <button disabled={chosen.every((a) => a.archivedAt)} onClick={() => (markPlayedWithUndo(chosen.filter((a) => !a.archivedAt).map((a) => a.id)), done())}>
              <Icon name="mark-played" />
              Mark played
            </button>
            {/* One action for "this didn't work" and "make this again": failed articles are tried again, the rest get new audio in the current voice. */}
            <button
              disabled={!online || !chosen.some(isRefreshable)}
              onClick={() =>
                void refreshMany(ids).then(({ retried, rerendered }) => {
                  done();
                  showSnack({ text: rerendered ? 'Preparing the audio again' : retried ? 'Trying again' : 'Nothing to refresh' });
                })
              }
            >
              <Icon name="re-render" />
              Refresh
            </button>
          </div>
        ) : (
          <>
            <MiniPlayer />
            <TabBar />
          </>
        )}
      </div>
    </div>
  );
}
