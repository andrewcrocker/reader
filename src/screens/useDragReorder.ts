import { useEffect, useRef, useState, type RefObject } from 'react';

// Hold-to-grab reorder for Up next (DESIGN §1 "Reorder"). A row is grabbed after a hold (or at once
// from a drag handle); it follows the pointer while the rows it passes slide apart to show the slot,
// and the page scrolls when the row nears the top or bottom edge. Release drops it into the slot.
// Rows are moved with transforms only; the real order changes once, on drop.

export interface GrabPoint {
  pointerId: number;
  clientX: number;
  clientY: number;
}

interface Options {
  /** Up next ids, in order. */
  ids: string[];
  rowEls: RefObject<Map<string, HTMLElement>>;
  listRef: RefObject<HTMLElement | null>;
  /** The row was dropped at index `to` (only called when it moved). Must show the new order synchronously. */
  onDrop: (id: string, to: number) => Promise<void> | void;
  /** A hold was released without moving: what a long-press did before (enter multi-select). */
  onHoldRelease: (id: string) => void;
}

/** Movement after the hold that turns it into a drag. */
const DRAG_SLOP = 8;
/** Distance from the top/bottom edge where auto-scroll starts, and its top speed per frame. */
const EDGE = 72;
const MAX_SCROLL = 18;
const DROP_MS = 150;
const LIFT_SCALE = 1.02;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Drag {
  id: string;
  pointerId: number;
  phase: 'held' | 'drag' | 'drop';
  x: number;
  y: number;
  lastY: number;
  startScroll: number;
  ids: string[];
  from: number;
  to: number;
  rects: { top: number; h: number }[];
  raf?: number;
}

export function useDragReorder(o: Options) {
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const opts = useRef(o);
  opts.current = o;
  const drag = useRef<Drag | null>(null);

  // While a row is grabbed, touch moves drag it instead of scrolling the page. Has to be a
  // non-passive touch listener on the list from before the touch starts: `touch-action` can't
  // change once a touch has begun. The list comes and goes (empty state), so re-check each render.
  const attached = useRef<HTMLElement | null>(null);
  const stopTouch = useRef((e: TouchEvent) => {
    if (drag.current) e.preventDefault();
  }).current;
  useEffect(() => {
    const list = o.listRef.current;
    if (list === attached.current) return;
    attached.current?.removeEventListener('touchmove', stopTouch);
    list?.addEventListener('touchmove', stopTouch, { passive: false });
    attached.current = list;
  });
  useEffect(() => () => attached.current?.removeEventListener('touchmove', stopTouch), []);

  const el = (id: string) => opts.current.rowEls.current?.get(id);

  const clearStyles = (d: Drag) => {
    for (const id of d.ids) {
      const e = el(id);
      if (e) e.style.transform = e.style.transition = '';
    }
  };

  const end = () => {
    const d = drag.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    const list = opts.current.listRef.current;
    list?.classList.add('settling');
    clearStyles(d);
    list?.classList.remove('reordering');
    // Let the cleared transforms apply without transitions before turning them back on.
    requestAnimationFrame(() => requestAnimationFrame(() => list?.classList.remove('settling')));
    drag.current = null;
    setLiftedId(null);
  };

  /** Lay out the grabbed row at the pointer and slide the others around its slot. */
  const layout = () => {
    const d = drag.current;
    if (!d || d.phase !== 'drag') return;
    const me = d.rects[d.from];
    const first = d.rects[0];
    const last = d.rects[d.rects.length - 1];
    let dy = d.lastY - d.y + (scrollY - d.startScroll);
    // Keep the row within the Up next list.
    dy = Math.max(first.top - me.top, Math.min(last.top + last.h - me.h - me.top, dy));
    const center = me.top + dy + me.h / 2;
    let to = 0;
    d.rects.forEach((r, i) => {
      if (i !== d.from && r.top + r.h / 2 < center) to++;
    });
    const self = el(d.id);
    if (self) self.style.transform = `translateY(${dy}px)${reducedMotion() ? '' : ` scale(${LIFT_SCALE})`}`;
    if (to === d.to) return;
    d.to = to;
    d.ids.forEach((id, i) => {
      if (i === d.from) return;
      const e = el(id);
      if (!e) return;
      const shift = d.from < i && i <= to ? -me.h : to <= i && i < d.from ? me.h : 0;
      e.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };

  /** Scroll the page while the pointer is near an edge, re-laying out each frame. */
  const tick = () => {
    const d = drag.current;
    if (!d || d.phase !== 'drag') return;
    const bottom = document.querySelector('.dock')?.getBoundingClientRect().top ?? innerHeight;
    const top = 0;
    let v = 0;
    if (d.lastY < top + EDGE) v = -MAX_SCROLL * Math.min(1, (top + EDGE - d.lastY) / EDGE);
    else if (d.lastY > bottom - EDGE) v = MAX_SCROLL * Math.min(1, (d.lastY - (bottom - EDGE)) / EDGE);
    if (v) {
      scrollBy(0, v);
      layout();
    }
    d.raf = requestAnimationFrame(tick);
  };

  const startDrag = (d: Drag) => {
    d.phase = 'drag';
    d.startScroll = scrollY;
    d.ids = [...opts.current.ids];
    d.from = d.to = d.ids.indexOf(d.id);
    d.rects = d.ids.map((id) => {
      const r = el(id)?.getBoundingClientRect();
      return { top: (r?.top ?? 0) + scrollY, h: r?.height ?? 0 };
    });
    opts.current.listRef.current?.classList.add('reordering');
    const self = el(d.id);
    // The grabbed row follows the pointer with no lag; only its shadow eases.
    if (self) self.style.transition = 'box-shadow 150ms';
    layout();
    d.raf = requestAnimationFrame(tick);
  };

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    if (d.phase === 'held' && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_SLOP) startDrag(d);
    else layout();
  }

  function onUp(e: PointerEvent) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.phase === 'held') {
      const id = d.id;
      end();
      return opts.current.onHoldRelease(id);
    }
    if (d.phase !== 'drag') return;
    d.phase = 'drop';
    if (d.raf) cancelAnimationFrame(d.raf);
    const { id, from, to } = d;
    // Settle into the slot, then commit the new order.
    const slot = to > from ? d.rects[to].top + d.rects[to].h - d.rects[from].h : to < from ? d.rects[to].top : d.rects[from].top;
    const self = el(id);
    const quick = reducedMotion();
    if (self) {
      self.style.transition = quick ? 'none' : `transform ${DROP_MS}ms var(--ease)`;
      self.style.transform = `translateY(${slot - d.rects[from].top}px)`;
    }
    setTimeout(
      () => {
        // onDrop shows the new order synchronously (flushSync), so clearing the transforms right
        // after lands in the same frame and nothing jumps.
        const saved = to === from ? undefined : opts.current.onDrop(id, to);
        end();
        void saved;
      },
      quick ? 0 : DROP_MS,
    );
  }

  function onCancel(e: PointerEvent) {
    if (drag.current && e.pointerId === drag.current.pointerId && drag.current.phase !== 'drop') end();
  }

  /** Pick a row up: `held` after a hold (moving starts the drag), `drag` straight from a handle. */
  const grab = (id: string, p: GrabPoint, phase: 'held' | 'drag') => {
    if (drag.current) return;
    navigator.vibrate?.(10);
    const d: Drag = { id, pointerId: p.pointerId, phase: 'held', x: p.clientX, y: p.clientY, lastY: p.clientY, startScroll: scrollY, ids: [], from: 0, to: 0, rects: [] };
    drag.current = d;
    setLiftedId(id);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (phase === 'drag') startDrag(d);
  };

  return { liftedId, grab };
}
