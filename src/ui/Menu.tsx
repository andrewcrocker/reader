import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon: IconName;
  danger?: boolean;
  run: () => void;
}

/**
 * A "more actions" button with a small popup menu. The popup is portaled to <body> with fixed
 * positioning, so a row's overflow (for swipe) can't clip it; it flips above the button near the
 * bottom of the screen. Keyboard: arrows move, Escape closes and returns focus.
 */
export function MenuButton({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  // Reset on close so the next open waits for a fresh position.
  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const up = r.bottom + 8 + items.length * 48 + 16 > innerHeight;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, right: innerWidth - r.right, up });
  }, [open, items.length]);

  // Runs once the popup is positioned (and so in the DOM).
  useEffect(() => {
    if (!open || !pos) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    const close = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, pos]);

  const shut = () => {
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') shut();

    else if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else return;
    e.preventDefault();
  };

  return (
    <>
      <button ref={btn} className="icon-btn row-action" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            aria-label={label}
            onKeyDown={onKey}
            style={{ right: pos.right, ...(pos.up ? { bottom: innerHeight - pos.top } : { top: pos.top }) }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className={it.danger ? 'danger' : undefined}
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
              >
                <Icon name={it.icon} size={20} />
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
