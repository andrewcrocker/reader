import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Article } from '../db';
import { hasRealTitle, urlTitle, type RowMeta } from '../queue/display';
import { Art } from '../ui/Art';
import { Icon, StatusGlyph } from '../ui/Icon';

const LONG_PRESS_MS = 500;
const SLOP = 10;

export interface RowProps {
  article: Article;
  meta: RowMeta;
  playing: boolean;
  played: boolean;
  isNew: boolean;
  online: boolean;
  selecting: boolean;
  selected: boolean;
  dragging?: boolean;
  onTap: () => void;
  onLongPress: () => void;
  onSwipe?: (dir: 'left' | 'right') => void;
  onStatus?: () => void;
  onRetry?: () => void;
  onHandleDown?: (e: RPointerEvent) => void;
  rowRef?: (el: HTMLElement | null) => void;
}

/** One queue row (DESIGN "Article states"). Swipe left deletes, right marks played; long-press selects. */
export function QueueRow(p: RowProps) {
  const a = p.article;
  const [dx, setDx] = useState(0);
  const g = useRef<{ x: number; y: number; mode: 'idle' | 'swipe' | 'scroll'; timer?: ReturnType<typeof setTimeout>; suppress: boolean }>({ x: 0, y: 0, mode: 'idle', suppress: false });
  const urlish = !hasRealTitle(a) && a.source === 'url';
  const failed = p.meta.glyph === 'failed';
  const partial = p.meta.glyph === 'partial';

  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle, .row-action, .meta-btn')) return;
    const s = g.current;
    s.x = e.clientX;
    s.y = e.clientY;
    s.mode = 'idle';
    s.suppress = false;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (s.mode === 'idle') {
        s.suppress = true;
        navigator.vibrate?.(10);
        p.onLongPress();
      }
    }, LONG_PRESS_MS);
  };
  const move = (e: RPointerEvent) => {
    const s = g.current;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (s.mode === 'idle' && (Math.abs(mx) > SLOP || Math.abs(my) > SLOP)) {
      clearTimeout(s.timer);
      s.mode = !p.selecting && p.onSwipe && Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll';
      if (s.mode === 'swipe') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (s.mode === 'swipe') setDx(mx);
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
  };

  const cls = ['row', p.playing && 'playing', p.played && 'played', (p.selected || p.isNew) && (p.selected ? 'selected' : 'is-new'), p.selecting && 'selecting', (failed || p.onRetry) && !p.selecting && 'has-action', p.dragging && 'dragging']
    .filter(Boolean)
    .join(' ');

  const metaInner = (
    <>
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
    <li className="row-wrap" ref={p.rowRef} data-id={a.id}>
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
        onPointerCancel={() => {
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
        <Art article={a} size={52} placeholder={urlish} />
        <div className="row-main">
          {/* The whole row is the tap target; this button gives it a name and keyboard access. */}
          <button className="row-main row-tap" aria-label={p.meta.spoken}>
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
        {p.selecting && p.onHandleDown && (
          <button className="drag-handle" aria-label={`Reorder ${a.title}`} onPointerDown={p.onHandleDown}>
            <Icon name="drag" />
          </button>
        )}
      </div>
    </li>
  );
}
