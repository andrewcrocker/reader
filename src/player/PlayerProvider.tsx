import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, updateSettings, type Article } from '../db';
import { loadAudio } from '../audio/storage';
import { rasterCover, useArtUrl } from '../art/art';
import { coverColor } from '../ui/Art';
import { coverInk } from '../theme/color';
import { lengthSec, siteLabel } from '../queue/display';
import { purgeArticle } from '../pipeline/runner';
import { useAppData } from '../app/data';
import { applyTint } from './tint';
import { nextSentenceStart, prevSentenceStart } from './sentences';
import { canStream, RenderStream, type StreamTimeline } from './stream';

// One <audio> at the root, shared by the mini player, Now Playing, and Lyrics (SPEC §7).

const SAVE_EVERY_MS = 5000;
export const MIN_SPEED = 0.8;
export const MAX_SPEED = 3.0;

export interface PlayerApi {
  current?: Article;
  playing: boolean;
  /** Seconds into the audio (1.0× timeline). */
  time: number;
  /** Length at 1.0×: the file's once loaded, else the article's estimate. */
  duration: number;
  /** Audio is loaded and can play. */
  loaded: boolean;
  /** Playing while the article still renders; `renderedUntil` is how far audio exists. */
  streaming: boolean;
  renderedUntil: number;
  /** Playback caught up with rendering and is waiting for more audio. */
  waiting: boolean;
  /** The current article's sentences, with times for whatever is playable so far. */
  sentences: Article['sentences'];
  speed: number;
  audio: () => HTMLAudioElement | null;
  play: (id?: string) => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (dir: 1 | -1) => void;
  sentence: (dir: 1 | -1) => void;
  article: (dir: 1 | -1) => void;
  setSpeed: (v: number) => void;
  /** The next playable article in Up next, for the peek and auto-advance. */
  next?: Article;
}

const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer outside PlayerProvider');
  return v;
}

const hasFile = (a: Article) => a.status === 'ready' && !!a.audioKey;

/** Can play now: a finished file, or (where the browser supports it) streamed while rendering. */
export const isPlayable = (a: Article) => !a.deletedAt && (hasFile(a) || (a.status === 'rendering' && canStream()));

/** Neighbor in Up next, by queue order, that can play now. */
function neighbor(upNext: Article[], current: Article | undefined, dir: 1 | -1): Article | undefined {
  if (!current) return upNext.find(isPlayable);
  const candidates = upNext.filter((a) => a.id !== current.id && isPlayable(a));
  if (dir === 1) return candidates.find((a) => a.queueOrder > current.queueOrder) ?? (current.archivedAt ? candidates[0] : undefined);
  return candidates.filter((a) => a.queueOrder < current.queueOrder).pop();
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { articles, upNext, settings } = useAppData();
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = articles.find((a) => a.id === settings.lastPlayingArticleId && !a.deletedAt);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(current?.positionSec ?? 0);
  const [fileDuration, setFileDuration] = useState(0);
  const [speed, setSpeedState] = useState(settings.speed);
  const [timeline, setTimeline] = useState<StreamTimeline | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pendingPlay = useRef(false);
  const stream = useRef<RenderStream | null>(null);
  const loadedRef = useRef<string | null>(null);
  /** Position and play state carried from the stream to the finished file of the same article. */
  const handoff = useRef<{ id: string; time: number; playing: boolean } | null>(null);
  const sentences = timeline?.sentences ?? current?.sentences ?? [];
  const latest = useRef({ current, upNext, settings, speed, sentences });
  latest.current = { current, upNext, settings, speed, sentences };

  useEffect(() => setSpeedState(settings.speed), [settings.speed]);

  // ---- Load the current article: its finished file, or a stream while it renders ----
  const source = !current ? 'none' : hasFile(current) ? `file:${current.audioKey}` : isPlayable(current) ? 'stream' : 'none';
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const cur = latest.current.current;
    // Same article, already playing from the stream: carry the position over to the file.
    handoff.current = cur && loadedRef.current === cur.id && el.currentSrc ? { id: cur.id, time: el.currentTime, playing: !el.paused } : null;
    let url: string | null = null;
    let live = true;
    loadedRef.current = null;
    setLoadedId(null);
    setFileDuration(0);
    setWaiting(false);
    if (!handoff.current) setTime(cur?.positionSec ?? 0);
    if (source === 'stream' && cur) {
      const s = new RenderStream(cur, setTimeline);
      stream.current = s;
      el.src = s.url;
      return () => {
        s.dispose();
        stream.current = null;
      };
    }
    setTimeline(null);
    const audioKey = source.startsWith('file:') ? source.slice(5) : undefined;
    if (!audioKey) {
      el.removeAttribute('src');
      el.load();
      return;
    }
    void loadAudio(audioKey).then((blob) => {
      if (!live) return;
      if (!blob) {
        // Audio went missing (storage cleared): queue it to render again.
        const id = latest.current.current?.id;
        if (id) void db.articles.update(id, { status: 'extracted', audioKey: undefined, renderProgress: 0 });
        return;
      }
      url = URL.createObjectURL(blob);
      el.src = url;
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [current?.id, source]);

  // Each finished chunk bumps render progress; hand the new audio to the stream.
  useEffect(() => void stream.current?.poke(), [current?.renderProgress]);

  const savePosition = useCallback(() => {
    const el = audioRef.current;
    const id = latest.current.current?.id;
    if (el && id && el.readyState > 0 && el.currentSrc) void db.articles.update(id, { positionSec: el.currentTime });
  }, []);

  // §11a: every ~5 s while playing, on pause, and when the page is hidden or unloading.
  useEffect(() => {
    const iv = setInterval(() => audioRef.current && !audioRef.current.paused && savePosition(), SAVE_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && savePosition();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', savePosition);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', savePosition);
    };
  }, [savePosition]);

  // ---- Controls ----
  const play = useCallback(
    (id?: string) => {
      const el = audioRef.current;
      const cur = latest.current.current;
      if (!id || id === cur?.id) {
        if (el?.currentSrc) void el.play().catch(() => {});
        else pendingPlay.current = true;
        return;
      }
      savePosition();
      el?.pause();
      pendingPlay.current = true;
      void updateSettings({ lastPlayingArticleId: id });
    },
    [savePosition],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el?.currentSrc) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback(
    (t: number) => {
      const el = audioRef.current;
      if (!el?.currentSrc) return;
      // Clamp to what exists; seeking past the rendered point snaps back to it.
      const end = stream.current ? (el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0) : el.duration || t;
      el.currentTime = Math.max(0, Math.min(t, end - 0.05));
      setTime(el.currentTime);
      savePosition();
    },
    [savePosition],
  );

  const skip = useCallback((dir: 1 | -1) => {
    const el = audioRef.current;
    if (el) seek(el.currentTime + dir * latest.current.settings.skipSeconds);
  }, [seek]);

  const sentence = useCallback(
    (dir: 1 | -1) => {
      const el = audioRef.current;
      const s = latest.current.sentences;

      if (!el || !s.length) return;
      const t = dir === 1 ? nextSentenceStart(s, el.currentTime) : prevSentenceStart(s, el.currentTime);
      if (t !== undefined) seek(t);
    },
    [seek],
  );

  const article = useCallback(
    (dir: 1 | -1) => {
      const { upNext: list, current: cur } = latest.current;
      const target = neighbor(list, cur, dir);
      if (target) play(target.id);
      else if (dir === -1) seek(0);
    },
    [play, seek],
  );

  const setSpeed = useCallback((v: number) => {
    const s = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, v)) * 100) / 100;
    setSpeedState(s);
    latest.current.speed = s;
    const el = audioRef.current;
    if (el) el.playbackRate = el.defaultPlaybackRate = s;
    void updateSettings({ speed: s });
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = el.defaultPlaybackRate = speed;
    el.preservesPitch = true;
  }, [speed, loadedId]);

  // ---- On finish: mark played, archive or delete, then auto-advance (SPEC §7) ----
  const onEnded = useCallback(async () => {
    const { current: done, upNext: list, settings: s } = latest.current;
    if (!done) return;
    const next = s.autoAdvance ? neighbor(list, done, 1) : undefined;
    const now = Date.now();
    if (s.keepPlayed === 'delete') await purgeArticle(done.id);
    else await db.articles.update(done.id, { playedAt: now, archivedAt: done.archivedAt ?? now, positionSec: 0 });
    // Replaying from the Archive starts over.
    if (audioRef.current) audioRef.current.currentTime = 0;
    setTime(0);
    if (next) play(next.id);

  }, [play]);

  // ---- Article tint follows the playing article ----
  useEffect(() => applyTint(current?.tintSource), [current?.tintSource]);

  // ---- Media Session: lock screen, notification, headset buttons ----
  const artUrl = useArtUrl(current?.articleArtKey ?? current?.siteArtKey);
  const [coverUrl, setCoverUrl] = useState<string>();
  useEffect(() => {
    if (!current || artUrl) return setCoverUrl(undefined);
    let url: string | undefined;
    let live = true;
    const bg = coverColor(current);
    void rasterCover(current.title, siteLabel(current), bg, coverInk(bg)).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setCoverUrl(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [current?.id, current?.title, artUrl]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    const art = artUrl ?? coverUrl;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: siteLabel(current) ?? '',
      artwork: art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : [],
    });
  }, [current?.id, current?.title, current?.siteName, artUrl, coverUrl]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', (d) => (d.seekOffset ? seek(audioRef.current!.currentTime - d.seekOffset) : skip(-1))],
      ['seekforward', (d) => (d.seekOffset ? seek(audioRef.current!.currentTime + d.seekOffset) : skip(1))],
      ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
      ['previoustrack', () => article(-1)],
      ['nexttrack', () => article(1)],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    }
    return () => handlers.forEach(([action]) => {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* */
      }
    });
  }, [play, seek, skip, article]);

  const positionState = () => {
    const el = audioRef.current;
    if (!el || !('mediaSession' in navigator) || !Number.isFinite(el.duration)) return;
    try {
      navigator.mediaSession.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: el.playbackRate });
    } catch {
      /* */
    }
  };

  const streaming = source === 'stream';
  const chunkCount = current?.chunks?.length ?? 0;
  // While streaming the file only covers what's rendered, so estimate the whole length from the
  // rendered share (more accurate than the word-count estimate once a few chunks are in).
  const duration = streaming
    ? timeline?.chunks && chunkCount
      ? (timeline.until * chunkCount) / timeline.chunks
      : (current && lengthSec(current)) ?? 0
    : fileDuration || current?.durationSec || (current ? lengthSec(current) ?? 0 : 0);
  const renderedUntil = streaming ? timeline?.until ?? 0 : duration;
  const next = neighbor(upNext, current, 1);

  const api = useMemo<PlayerApi>(
    () => ({
      current,
      playing,
      time,
      duration,
      loaded: !!current && loadedId === current.id,
      streaming,
      renderedUntil,
      waiting,
      sentences,
      speed,
      audio: () => audioRef.current,
      play,
      toggle,
      seek,
      skip,
      sentence,
      article,
      setSpeed,
      next,
    }),
    [current, playing, time, duration, loadedId, streaming, renderedUntil, waiting, sentences, speed, play, toggle, seek, skip, sentence, article, setSpeed, next],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio
        ref={audioRef}
        preload="auto"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          const cur = latest.current.current;
          setFileDuration(el.duration);
          el.playbackRate = el.defaultPlaybackRate = latest.current.speed;
          el.preservesPitch = true;
          const carried = handoff.current?.id === cur?.id ? handoff.current : null;
          handoff.current = null;
          if (carried) el.currentTime = Math.min(carried.time, el.duration - 0.05);
          // Resume where we left off unless we were at the very end (a stream's length isn't known yet).
          else if (cur && cur.positionSec > 0 && (stream.current || cur.positionSec < el.duration - 1)) el.currentTime = cur.positionSec;
          setTime(el.currentTime);
          loadedRef.current = cur?.id ?? null;
          setLoadedId(cur?.id ?? null);
          positionState();
          if (pendingPlay.current || carried?.playing) {
            pendingPlay.current = false;
            void el.play().catch(() => {});
          }
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        // Caught up with rendering: the element waits for the next chunk on its own.
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}

        onSeeked={positionState}
        onRateChange={positionState}
        onPlay={() => {
          setPlaying(true);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        }}
        onPause={() => {
          setPlaying(false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          savePosition();
        }}
        onEnded={() => {
          setPlaying(false);
          void onEnded();
        }}
      />
    </Ctx.Provider>
  );
}
