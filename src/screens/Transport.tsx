import { useRef, type ReactNode } from 'react';
import { usePlayer } from '../player/PlayerProvider';
import { openSheet } from '../app/ui';
import { updateSettings } from '../db';
import { useAppData } from '../app/data';
import { fmtSpeed } from '../queue/display';
import { Icon, SkipIcon } from '../ui/Icon';

const LONG_PRESS_MS = 550;

/** Skip back/forward; long-press jumps to the previous/next article (DESIGN §3.5). */
export function SkipButton({ dir, size = 34, className = 't-btn' }: { dir: 1 | -1; size?: number; className?: string }) {
  const p = usePlayer();
  const { settings } = useAppData();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const long = useRef(false);
  const n = settings.skipSeconds;
  return (
    <button
      className={className}
      disabled={!p.loaded}
      aria-label={`${dir === 1 ? 'Forward' : 'Back'} ${n} seconds. Long-press for ${dir === 1 ? 'next' : 'previous'} article`}
      onPointerDown={() => {
        long.current = false;
        timer.current = setTimeout(() => {
          long.current = true;
          navigator.vibrate?.(10);
          p.article(dir);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => !long.current && p.skip(dir)}
    >
      <SkipIcon dir={dir === 1 ? 'forward' : 'back'} seconds={n} size={size} stroke={size > 30 ? 1.5 : 1.6} />
    </button>
  );
}

export function PlayButton({ small }: { small?: boolean }) {
  const p = usePlayer();
  return (
    <button className={`play-btn${small ? ' small' : ''}`} disabled={!p.loaded} aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.toggle}>
      <Icon name={p.playing ? 'pause' : 'play'} size={small ? 28 : 34} />
    </button>
  );
}

export function SpeedPill({ narrow }: { narrow?: boolean }) {
  const p = usePlayer();
  return (
    <button className="pill speed" style={narrow ? { width: 60, padding: 0 } : undefined} aria-label={`Playback speed, ${Number(p.speed.toFixed(2))} times`} onClick={() => openSheet({ kind: 'speed' })}>
      {fmtSpeed(p.speed)}
    </button>
  );
}

export function ReadAlongPill({ children }: { children?: ReactNode }) {
  const { settings } = useAppData();
  const on = settings.lyricsOn;
  return (
    <button className={`pill${on ? ' on' : ''}${children ? '' : ' icon'}`} aria-pressed={on} aria-label={children ? undefined : 'Read along'} onClick={() => void updateSettings({ lyricsOn: !on })}>
      <Icon name="read-along" size={children ? 20 : 22} stroke={2} />
      {children}
    </button>
  );
}
