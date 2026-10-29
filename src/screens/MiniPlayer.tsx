import { useRef } from 'react';
import { openNowPlaying, useWide } from '../app/ui';
import { usePlayer } from '../player/PlayerProvider';
import { fmtDuration, siteLabel } from '../queue/display';
import { Art } from '../ui/Art';
import { Icon } from '../ui/Icon';

/** DESIGN §2: always-dark card above the gesture bar. Tap or swipe up opens Now Playing. */
export function MiniPlayer() {
  const p = usePlayer();
  const startY = useRef<number | null>(null);
  const wide = useWide();
  const a = p.current;
  // In the wide layout Now Playing is always on screen, so there's no mini player.
  if (!a || wide) return null;

  const rendering = a.status === 'rendering' || a.status === 'extracted';
  const pct = Math.round((a.renderProgress ?? 0) * 100);
  const left = Math.max(0, p.duration - p.time) / p.speed;
  const sub = p.streaming && p.loaded ? `${fmtDuration(left)} left · preparing ${pct}%` : rendering ? `Preparing ${pct}%` : `${fmtDuration(left)} left`;

  return (
    <div
      className="mini"
      onPointerDown={(e) => (startY.current = e.clientY)}
      onPointerMove={(e) => {
        if (startY.current !== null && e.clientY - startY.current < -30) {
          startY.current = null;
          openNowPlaying();
        }
      }}
      onPointerUp={() => (startY.current = null)}
      onPointerLeave={() => (startY.current = null)}

    >
      <div className="mini-progress" aria-hidden="true">
        <div style={{ width: `${p.duration ? (p.time / p.duration) * 100 : 0}%` }} />
      </div>
      <div className="mini-body">
        <button className="mini-open" onClick={openNowPlaying} aria-label={`Now playing: ${a.title}. Open player`}>
          <Art article={a} size={44} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <p className="mini-title">{a.title}</p>
            <p className="mini-sub">{[siteLabel(a), sub].filter(Boolean).join(' · ')}</p>
          </span>
        </button>
        <button
          className="icon-btn"
          aria-label={p.playing ? 'Pause' : 'Play'}
          disabled={!p.loaded}
          onClick={() => (p.loaded ? p.toggle() : p.play())}
          style={{ opacity: p.loaded ? 1 : 0.5 }}
        >
          <Icon name={p.playing ? 'pause' : 'play'} size={26} />
        </button>
      </div>
    </div>
  );
}
