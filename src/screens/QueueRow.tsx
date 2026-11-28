import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Article, Feed } from '../db';
import { hasRealTitle, urlTitle, type RowMeta } from '../queue/display';
import { Art, FeedBadge } from '../ui/Art';
import { Icon, StatusGlyph } from '../ui/Icon';
import { MenuButton, type MenuItem } from '../ui/Menu';
import type { GrabPoint } from './useDragReorder';

/** Hold this long to grab a row; moving more than SLOP first means scroll or swipe instead. */
const LONG_PRESS_MS = 400;
const SLOP = 8;

export interface RowProps {
  article: Article;
  meta: RowMeta;
  playing: boolean;
  played: boolean;
  isNew: boolean;
  online: boolean;
  selecting: boolean;
  selected: boolean;
  /** Picked up for reordering. */
  lifted?: boolean;
  onTap: () => void;
  /** Hold with no way to reorder (Archive rows): enter multi-select. */
  onLongPress: () => void;
  /** Up next rows: a hold (or the handle) picks the row up. Releasing a hold without moving selects it. */
  onGrab?: (p: GrabPoint, phase: 'held' | 'drag') => void;
  /** Move up / down one place (handle keyboard). */
  onMove?: (delta: number) => void;
  onSwipe?: (dir: 'left' | 'right') => void;
  /** False for an archived row: it's already played, so a right drag doesn't swipe (it's ignored, as a vertical drag is). Default true. */
  canMarkPlayed?: boolean;
  onStatus?: () => void;
  onRetry?: () => void;
  rowRef?: (el: HTMLElement | null) => void;
  /** The blog this article was added from, if it came from Subscriptions: its art gets a small mark. */
  feed?: Feed;
  /** "More actions" menu at the end of the row: favorite, mark played, delete and the like. */
  menu?: MenuItem[];
}

/** One queue row (DESIGN "Article states"). Swipe left deletes, right marks played; hold to move it, or hold and release to select. */
export function QueueRow(p: RowProps) {
  const a = p.article;
  const [dx, setDx] = useState(0);
  // `down` is set only between pointerdown and pointerup, so a mouse hovering over the row never swipes.
  const g = useRef<{ x: number; y: number; down: boolean; mode: 'idle' | 'swipe' | 'scroll' | 'held'; timer?: ReturnType<typeof setTimeout>; suppress: boolean }>({ x: 0, y: 0, down: false, mode: 'idle', suppress: false });
  const urlish = !hasRealTitle(a) && a.source === 'url';
  const failed = p.meta.glyph === 'failed';
  const partial = p.meta.glyph === 'partial';

  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle, .row-action, .meta-btn, .love-btn')) return;
    const s = g.current;
    s.x = e.clientX;
    s.y = e.clientY;
    s.mode = 'idle';
    s.down = true;
    s.suppress = false;
    clearTimeout(s.timer);
    const pt = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
    s.timer = setTimeout(() => {
      if (s.mode !== 'idle') return;
      s.suppress = true;
      // From here the reorder hook owns the pointer: it drags, or selects on release.
      if (p.onGrab) {
        s.mode = 'held';
        p.onGrab(pt, 'held');
      } else {
        navigator.vibrate?.(10);
        p.onLongPress();
      }
    }, LONG_PRESS_MS);
  };
  const move = (e: RPointerEvent) => {
    const s = g.current;
    if (!s.down || s.mode === 'held') return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.mode === 'idle' && (Math.abs(mx) > SLOP || Math.abs(my) > SLOP)) {
      clearTimeout(s.timer);
      const allowed = mx < 0 || p.canMarkPlayed !== false;
      s.mode = !p.selecting && p.onSwipe && allowed && Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
      if (s.mode === 'swipe') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    // Once a left swipe is under way, dragging back past the start stops at the start instead of showing "Mark played".
    if (s.mode === 'swipe') setDx(p.canMarkPlayed === false ? Math.min(0, mx) : mx);
  };
  const up = (e: RPointerEvent) => {
    const s = g.current;
    clearTimeout(s.timer);
    if (s.mode === 'swipe') {
      s.suppress = true;
      const width = (e.currentTarget as HTMLElement).offsetWidth;
      if (Math.abs(dx) > Math.min(120, width * 0.35)) {
        setDx(dx > 0 ? width : -width);
        setTimeout(() => {
          p.onSwipe?.(dx > 0 ? 'right' : 'left');
          setDx(0);
        }, 160);
      } else setDx(0);
    }
    s.mode = 'idle';
    s.down = false;
  };

  const cls = ['row', p.playing && 'playing', p.played && 'played', (p.selected || p.isNew) && (p.selected ? 'selected' : 'is-new'), p.selecting && 'selecting', (failed || p.onRetry || p.menu) && !p.selecting && 'has-action']
    .filter(Boolean)
    .join(' ');

  const metaInner = (
    <>
      {/* The heart moved into the row's menu; this is what still shows that an article is a favorite. */}
      {a.lovedAt && <Icon name="heart-filled" size={14} className="fav-mark" />}
      <StatusGlyph kind={p.meta.glyph} progress={a.renderProgress} />
      <span className="segs">
        {p.meta.segs.map((s, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            <span className={s.strong ? 'strong' : undefined}>{s.text}</span>
          </span>
        ))}
      </span>
    </>
  );

  return (
    <li className={`row-wrap${p.lifted ? ' lifted' : ''}`} ref={p.rowRef} data-id={a.id}>
      {dx !== 0 && (
        <div className={`row-swipe-bg ${dx > 0 ? 'right' : 'left'}`} aria-hidden="true">
          {dx > 0 ? (
            <>
              <Icon name="mark-played" /> Mark played
            </>
          ) : (
            <>
              Delete <Icon name="trash" />
            </>
          )}
        </div>
      )}
      <div
        className={cls}
        style={dx ? { transform: `translateX(${dx}px)`, transition: g.current.mode === 'swipe' ? 'none' : 'transform 160ms' } : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => {
          // Released outside the row without swiping (a captured swipe keeps its events).
          if (g.current.mode === 'swipe' || g.current.mode === 'held') return;
          g.current.down = false;
          clearTimeout(g.current.timer);
        }}
        onPointerCancel={() => {

          g.current.down = false;
          g.current.mode = 'idle';
          clearTimeout(g.current.timer);

          setDx(0);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          const hit = (e.target as HTMLElement).closest('button, input');
          if ((hit && !hit.classList.contains('row-tap')) || g.current.suppress) return;
          p.onTap();
        }}
      >

        {p.selecting && (
          <input type="checkbox" className="row-check" checked={p.selected} onChange={p.onTap} aria-label={`Select ${a.title}`} />
        )}
        <span className="art-wrap">
          <Art article={a} size={52} placeholder={urlish} />
          {p.feed && !urlish && <FeedBadge article={a} feed={p.feed} />}
        </span>
        <div className="row-main">
          {/* The whole row is the tap target; this button gives it a name and keyboard access. */}
          <button className="row-main row-tap" aria-label={a.lovedAt ? `${p.meta.spoken}. Favorite` : p.meta.spoken}>
            <p className={`row-title${urlish ? ' url' : ''}`}>{urlish ? urlTitle(a.url) : a.title}</p>
          </button>
          {partial && p.onStatus && !p.selecting ? (
            <p className={`row-meta tone-${p.meta.tone}`}>
              <button className="meta-btn" onClick={p.onStatus} aria-label="Only part of this article loaded. Details">
                {metaInner}
              </button>
            </p>
          ) : (
            <p className={`row-meta tone-${p.meta.tone}`} aria-hidden="true">
              {metaInner}
            </p>
          )}
          {p.meta.progress !== undefined && p.meta.progress > 0 && (
            <div className="row-progress" aria-hidden="true">
              <div style={{ width: `${p.meta.progress * 100}%` }} />
            </div>
          )}
        </div>
        {!p.selecting && p.onRetry && (
          <button
            className="text-btn row-action"
            disabled={!p.online}
            onClick={p.onRetry}
            aria-label={p.online ? 'Retry' : 'Retry, unavailable offline'}
            style={!p.online ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : undefined}
          >
            {!p.online && <Icon name="cloud-off" size={18} />}Retry
          </button>
        )}
        {!p.selecting && p.menu && <MenuButton label={`More actions for ${hasRealTitle(a) ? a.title : urlTitle(a.url)}`} items={p.menu} />}
        {p.selecting && p.onGrab && (
          <button
            className="drag-handle"
            aria-label={`Reorder ${a.title}. Arrow keys move it`}
            onPointerDown={(e) => {
              e.preventDefault();
              p.onGrab!({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY }, 'drag');
            }}
            onKeyDown={(e: KeyboardEvent) => {
              const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
              if (!delta) return;
              e.preventDefault();
              p.onMove?.(delta);
            }}
          >
            <Icon name="drag" />
          </button>
        )}
      </div>
    </li>
  );
}
