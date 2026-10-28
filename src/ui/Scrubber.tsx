import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtTime } from '../format';

function spokenTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? `${m} minute${m === 1 ? '' : 's'} ${s} seconds` : `${s} seconds`;
}

/**
 * Played (tint) over rendered (tint-rendered) over not-yet-rendered (dashed track). `rendered` is a
 * 0..1 fraction; below 1 the scrubber is in its "still rendering" form and seeks clamp to it.
 */
export function Scrubber({
  time,
  duration,
  rendered = 1,
  disabled,
  thin,
  onSeek,
}: {
  time: number;
  duration: number;
  rendered?: number;
  disabled?: boolean;
  thin?: boolean;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const max = duration * rendered;
  const shown = drag ?? time;
  const pct = (v: number) => `${duration ? Math.min(100, (v / duration) * 100) : 0}%`;

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(max, Math.max(0, ((e.clientX - r.left) / r.width) * duration));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      onSeek(Math.min(max, Math.max(0, time + step)));
    } else if (e.key === 'Home') onSeek(0);
  };

  return (
    <div
      ref={ref}
      className={`scrubber${thin ? ' thin' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Position"
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${spokenTime(shown)} of ${spokenTime(duration)}`}
      onKeyDown={disabled ? undefined : onKey}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(at(e))}
      onPointerUp={(e) => {
        if (drag === null) return;
        onSeek(at(e));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className={`bar${rendered < 1 ? ' pending' : ''}`} />
      {rendered < 1 && <div className="rendered" style={{ width: pct(max) }} />}
      <div className="played" style={{ width: pct(shown) }} />
      {!disabled && <div className="thumb" style={{ left: pct(shown) }} />}
    </div>
  );
}

export function Times({ time, duration, speed, center }: { time: number; duration: number; speed: number; center?: string }) {
  return (
    <div className="times">
      <span>{fmtTime(time)}</span>
      {center && <span className="center">{center}</span>}
      <span>−{fmtTime(Math.max(0, duration - time) / speed)}</span>
    </div>
  );
}
