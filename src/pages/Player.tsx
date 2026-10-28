import { useCallback, useEffect, useRef, useState } from 'react';
import { db, updateSettings, type Article, type Settings } from '../db';
import { loadAudio } from '../audio/storage';
import { fmtTime } from '../format';

const SAVE_EVERY_MS = 5000;
const MIN_SPEED = 0.8;
const MAX_SPEED = 3.0;

export function Player({ article, settings }: { article: Article; settings: Settings }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [time, setTime] = useState(article.positionSec);
  const [duration, setDuration] = useState(article.durationSec ?? 0);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // Local state so rapid taps compound before the settings write lands.
  const [speed, setSpeedState] = useState(settings.speed);
  const speedRef = useRef(settings.speed);

  // Load the audio file once per article.
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    setSrc(null);
    setMissing(false);
    if (!article.audioKey) return;
    loadAudio(article.audioKey).then((blob) => {
      if (!live) return;
      if (!blob) return setMissing(true);
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [article.id, article.audioKey]);

  const savePosition = useCallback(() => {
    const a = audioRef.current;
    if (a && a.readyState > 0) void db.articles.update(article.id, { positionSec: a.currentTime });
  }, [article.id]);

  // §11a: save every ~5 s while playing, on pause, and when the page is hidden or unloading.
  useEffect(() => {
    const iv = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) savePosition();
    }, SAVE_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && savePosition();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', savePosition);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', savePosition);
      savePosition();
    };
  }, [savePosition]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = speed;
    a.preservesPitch = true;
  }, [speed, src]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(t, a.duration || t));
    setTime(a.currentTime);
    savePosition();
  }, [savePosition]);

  const skip = useCallback((d: number) => {
    const a = audioRef.current;
    if (a) seek(a.currentTime + d);
  }, [seek]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  // Minimal Media Session so lock-screen / headset controls work for the Phase 0 background test.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: article.title,
      artist: article.siteName ?? '',
      artwork: article.imageUrl ? [{ src: article.imageUrl }] : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void audioRef.current?.play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', (d) => skip(-(d.seekOffset ?? settings.skipSeconds))],
      ['seekforward', (d) => skip(d.seekOffset ?? settings.skipSeconds)],
      ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    }
    return () => handlers.forEach(([action]) => { try { ms.setActionHandler(action, null); } catch { /* */ } });
  }, [article.id, article.title, article.siteName, article.imageUrl, seek, skip, settings.skipSeconds]);

  const setSpeed = (s: number) => {
    const v = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) * 10) / 10;
    speedRef.current = v;
    setSpeedState(v);
    void updateSettings({ speed: v });
  };

  const shown = scrubbing ?? time;
  const remaining = Math.max(0, duration - shown) / speed;

  if (article.status !== 'ready') {
    return (
      <section className="card player">
        <h2 className="title">{article.title}</h2>
        <p className="muted">Not ready yet ({article.status}{article.renderProgress ? ` ${Math.round(article.renderProgress * 100)}%` : ''}).</p>
      </section>
    );
  }

  return (
    <section className="card player">
      <h2 className="title">{article.title}</h2>
      <p className="muted small">{[article.siteName, article.byline].filter(Boolean).join(' · ')}</p>
      {missing && <p className="error">Audio file is missing from storage. Retry rendering from the list.</p>}
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="auto"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          setDuration(a.duration);
          a.playbackRate = speed;
          a.preservesPitch = true;
          // Resume where we left off unless we were at the very end.
          if (article.positionSec > 0 && article.positionSec < a.duration - 1) a.currentTime = article.positionSec;
          setTime(a.currentTime);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          void updateSettings({ lastPlayingArticleId: article.id });
        }}
        onPause={() => {
          setPlaying(false);
          savePosition();
        }}
        onEnded={() => {
          setPlaying(false);
          void db.articles.update(article.id, { playedAt: Date.now(), positionSec: 0 });
        }}
      />
      <input
        className="scrub"
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={shown}
        disabled={!src}
        onChange={(e) => setScrubbing(Number(e.target.value))}
        onPointerUp={() => { if (scrubbing !== null) { seek(scrubbing); setScrubbing(null); } }}
        onKeyUp={() => { if (scrubbing !== null) { seek(scrubbing); setScrubbing(null); } }}
        aria-label="Position"
      />
      <div className="row spread small muted">
        <span>{fmtTime(shown)}</span>
        <span>−{fmtTime(remaining)}{speed !== 1 && ` at ${speed.toFixed(1)}×`}</span>
      </div>
      <div className="row center controls">
        <button onClick={() => skip(-settings.skipSeconds)} disabled={!src} aria-label={`Back ${settings.skipSeconds} seconds`}>
          −{settings.skipSeconds}s
        </button>
        <button className="primary big" onClick={toggle} disabled={!src} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => skip(settings.skipSeconds)} disabled={!src} aria-label={`Forward ${settings.skipSeconds} seconds`}>
          +{settings.skipSeconds}s
        </button>
      </div>
      <div className="row center speed">
        <button onClick={() => setSpeed(speedRef.current - 0.1)} disabled={speed <= MIN_SPEED} aria-label="Slower">−</button>
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.1}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="Speed"
        />
        <button onClick={() => setSpeed(speedRef.current + 0.1)} disabled={speed >= MAX_SPEED} aria-label="Faster">+</button>
        <span className="speed-label">{speed.toFixed(1)}×</span>
      </div>
    </section>
  );
}
