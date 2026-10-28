import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Article } from '../db';
import { useAppData } from '../app/data';
import { openNowPlaying, openSettings, openSheet, showSnack, useUi } from '../app/ui';
import { isPlayable, usePlayer } from '../player/PlayerProvider';
import { displayState, queueSummary, rowMeta, voiceReady, type Ctx } from '../queue/display';
import { isRenderable, markPlayed, moveToTop, purgeDeleted, rerenderMany, retryMany, reorder, softDelete } from '../queue/actions';
import { retryArticle } from '../pipeline/runner';
import { Icon } from '../ui/Icon';
import { Snackbar } from '../ui/Snackbar';
import { MiniPlayer } from './MiniPlayer';
import { QueueRow } from './QueueRow';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
    showSnack({ text: ids.length === 1 ? 'Moved to Archive' : `${plural(ids.length, 'article')} moved to Archive`, actions: [{ label: 'Undo', run: undo }] }),
  );
}

export function Queue() {
  const { upNext, archive, settings, online } = useAppData();
  const player = usePlayer();
  const { newId } = useUi();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());

  const ctx: Ctx = { online, currentId: player.current?.id, voiceReady: voiceReady(settings), speed: player.speed };
  const selecting = selected !== null;
  const byId = new Map([...upNext, ...archive].map((a) => [a.id, a]));
  const shownUpNext = preview ? preview.map((id) => byId.get(id)!).filter(Boolean) : upNext;

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
    const state = displayState(a, ctx);
    if (state === 'failed') return openSheet({ kind: 'explain', id: a.id });
    if (isPlayable(a)) return player.play(a.id);
    if (a.archivedAt && isRenderable(a)) {
      void moveToTop([a.id]);
      return showSnack({ text: 'Back in Up next. Preparing the audio again.' });
    }
    if (state === 'rendering') {
      player.play(a.id);
      return openNowPlaying();
    }
    const why = { queued: 'Audio isn’t ready yet. It’s queued to prepare.', fetching: 'Still fetching this page.', waiting: 'This will fetch when you’re back online.' }[state as string];
    if (why) showSnack({ text: why });
  };

  // ---- Drag reorder (multi-select only): the row swaps with a neighbor as the pointer passes its middle ----
  const handleDown = (id: string) => (e: RPointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }

    let order = upNext.map((a) => a.id);
    setPreview(order);
    setDraggingId(id);
    const target = e.currentTarget as HTMLElement;
    const onMove = (ev: PointerEvent) => {
      const i = order.indexOf(id);
      const mid = (k: string | undefined) => {
        const r = k ? rowEls.current.get(k)?.getBoundingClientRect() : undefined;
        return r ? r.top + r.height / 2 : undefined;
      };
      const up = mid(order[i - 1]);
      const down = mid(order[i + 1]);
      if (up !== undefined && ev.clientY < up) order = [...order.slice(0, i - 1), id, order[i - 1], ...order.slice(i + 1)];
      else if (down !== undefined && ev.clientY > down) order = [...order.slice(0, i), order[i + 1], id, ...order.slice(i + 2)];
      else return;
      setPreview(order);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      const i = order.indexOf(id);
      if (order.join() !== upNext.map((a) => a.id).join()) void reorder(id, order[i - 1], order[i + 1]).then(() => setPreview(null));
      else setPreview(null);
      setDraggingId(null);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const row = (a: Article, inArchive: boolean) => {
    const state = displayState(a, ctx);
    const isNew = a.id === newId;
    const meta = rowMeta(a, state, { ...ctx, isNew });
    return (
      <QueueRow
        key={a.id}
        article={a}
        meta={meta}
        playing={a.id === player.current?.id}
        played={inArchive}
        isNew={isNew}
        online={online}
        selecting={selecting}
        selected={!!selected?.has(a.id)}
        dragging={draggingId === a.id}
        onTap={() => tap(a)}
        onLongPress={() => setSelected((s) => new Set(s).add(a.id))}
        onSwipe={(dir) => (dir === 'left' ? deleteWithUndo([a.id]) : !inArchive && markPlayedWithUndo([a.id]))}
        onStatus={() => openSheet({ kind: 'explain', id: a.id })}
        onRetry={state === 'failed' ? () => void retryArticle(a.id) : undefined}
        onHandleDown={inArchive ? undefined : handleDown(a.id)}
        rowRef={(el) => (el ? rowEls.current.set(a.id, el) : rowEls.current.delete(a.id))}
      />
    );
  };

  const empty = !upNext.length && !archive.length;
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
          <button className="text-btn" onClick={() => setSelected(new Set([...upNext, ...archive].map((a) => a.id)))}>
            Select all
          </button>
        </div>
      ) : (
        <header className="q-header">
          <div className="q-header-row">
            <h1 className="screen-title">Up next</h1>
            <div className="q-actions">
              <button className="icon-btn" aria-label="Settings" onClick={openSettings}>
                <Icon name="settings" />
              </button>
              <button className="icon-btn accent" aria-label="Add article" onClick={() => openSheet({ kind: 'add', tab: 'link' })}>
                <Icon name="add" stroke={2} />
              </button>
            </div>
          </div>
          {!empty && <p className="q-sub">{queueSummary(upNext, ctx)}</p>}
        </header>
      )}

      {!online && (
        <div className="offline-banner" role="status">
          <Icon name="cloud-off" size={18} /> Offline · ready articles still play
        </div>
      )}

      {empty ? (
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
      ) : (
        <ul className="q-list" aria-label="Queue">
          {shownUpNext.map((a) => row(a, false))}
          {archive.length > 0 && (
            <li className="q-section" aria-hidden="true">
              Archive
            </li>
          )}
          {archive.map((a) => row(a, true))}
        </ul>
      )}

      <div className="dock">
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
            <button onClick={() => (markPlayedWithUndo(ids), done())}>
              <Icon name="mark-played" />
              Mark played
            </button>
            <button
              disabled={!chosen.some(isRenderable)}
              onClick={() => void rerenderMany(ids.filter((id) => isRenderable(byId.get(id)!))).then(() => (done(), showSnack({ text: 'Preparing the audio again' })))}
            >
              <Icon name="re-render" />
              Re-render
            </button>
            <button disabled={!online || !chosen.some((a) => a.status === 'failed')} onClick={() => void retryMany(chosen.filter((a) => a.status === 'failed').map((a) => a.id)).then(done)}>
              <Icon name="retry" />
              Retry
            </button>
          </div>
        ) : (
          <MiniPlayer />
        )}
      </div>
    </div>
  );
}
