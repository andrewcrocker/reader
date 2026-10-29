import { useEffect, useRef, type ReactNode } from 'react';
import { back } from '../app/ui';
import { Icon } from './Icon';

/** Bottom sheet on `surface-sheet` with a scrim (DESIGN "Navigation"). Closing goes through history. */
export function Sheet({ title, label, wide, children, head = true }: { title?: ReactNode; label: string; wide?: boolean; head?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && back();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <div className="scrim" onClick={back} aria-hidden="true" />
      <section ref={ref} className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="grabber" aria-hidden="true" />
        {head && (
          <div className="sheet-head">
            <h2 className="sheet-title">{title ?? label}</h2>
            <button className="icon-btn" style={{ marginRight: -12 }} aria-label="Close" onClick={back}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {children}
      </section>
    </>
  );
}
