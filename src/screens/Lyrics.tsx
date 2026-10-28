import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { back } from '../app/ui';
import type { Article } from '../db';
import { usePlayer } from '../player/PlayerProvider';
import { sentenceAt } from '../player/sentences';
import { siteLabel } from '../queue/display';
import { Art } from '../ui/Art';
import { Icon } from '../ui/Icon';
import { Scrubber, Times } from '../ui/Scrubber';
import { PlayButton, ReadAlongPill, SkipButton, SpeedPill } from './Transport';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sentence index ranges per block, falling back to one paragraph when an article has no blocks. */
function blocksOf(a: Article) {
  if (a.blocks?.length) return a.blocks;
  return [{ kind: 'para' as const, first: 0, count: a.sentences.length }];
}

/** DESIGN §4: the article text, following the audio by sentence. */
export function Lyrics() {
  const p = usePlayer();
  const a = p.current!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(() => sentenceAt(a.sentences, p.time));
  const [following, setFollowing] = useState(true);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const timed = a.sentences.some((s) => s.start !== undefined);

  // SPEC §8: read audio.currentTime in rAF (timeupdate is ~4 Hz); no loop while hidden.
  useEffect(() => {
    if (!timed) return;
    let raf = 0;
    const tick = () => {
      const el = p.audio();
      if (el) setCur(sentenceAt(a.sentences, el.currentTime));
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(tick);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
    // p.audio() always returns the one root element, so the closure can't go stale.
  }, [a.id, a.sentences, timed]);

  const scrollToCurrent = (smooth: boolean) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    if (!box || !el) return;
    // Keep the current sentence about a third of the way down.
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 3;
    box.scrollTo({ top, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => scrollToCurrent(false), []);
  useEffect(() => {
    if (following) scrollToCurrent(true);
  }, [cur, following]);

  // Manual scroll (touch, wheel, keys) pauses auto-follow; programmatic scrolls don't fire these.
  const pause = () => {
    if (!following) return;
    setFollowing(false);
  };
  const onScroll = () => {
    if (following) return;
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    if (box && el) setDirection(el.getBoundingClientRect().top < box.getBoundingClientRect().top ? 'up' : 'down');
  };

  const byline = [a.byline, siteLabel(a)].filter(Boolean).join(' · ');
  const span = (i: number) => {
    const s = a.sentences[i];
    if (!s) return null;
    const cls = i < cur ? 's past' : i === cur ? 's cur' : 's';
    return (
      <span key={i}>
        <span
          className={cls}
          data-i={i}
          aria-current={i === cur ? 'true' : undefined}
          onClick={() => {
            if (s.start === undefined) return;
            p.seek(s.start);
            setFollowing(true);
          }}
        >
          {s.text}
        </span>{' '}
      </span>
    );
  };

  return (
    <div className="np" role="dialog" aria-label="Now playing, read along">
      <div className="np-inner" style={{ height: '100dvh', minHeight: 0 }}>
        <div className="lyrics-head">
          <button className="icon-btn" aria-label="Collapse player" onClick={back}>
            <Icon name="chevron-down" size={26} />
          </button>
          <Art article={a} size={36} />
          <div className="who">
            <p className="t">{a.title}</p>
            {byline && <p className="b">{byline}</p>}
          </div>
          {a.url && (
            <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" aria-label="Open original article">
              <Icon name="external" />
            </a>
          )}
        </div>
        <div className="lyrics-body">
          <div
            ref={scrollRef}
            className="lyrics-scroll"
            onTouchMove={pause}
            onWheel={pause}
            onKeyDown={pause}
            onScroll={onScroll}
            tabIndex={0}
            aria-label="Article text"
          >
            {blocksOf(a).map((b, k) => {
              const items = Array.from({ length: b.count }, (_, j) => span(b.first + j));
              if (b.kind === 'heading') return <h2 key={k}>{items}</h2>;

              return (
                <p key={k} className={b.kind === 'intro' ? 'intro' : undefined}>
                  {items}
                </p>
              );
            })}
          </div>
          {!following && (
            <button className="back-to-current" onClick={() => setFollowing(true)}>
              <Icon name="arrow-up" size={18} stroke={2.2} style={direction === 'down' ? { transform: 'rotate(180deg)' } : undefined} />
              Back to current
            </button>
          )}
        </div>
        <div className="lyrics-transport">
          <Scrubber thin time={p.time} duration={p.duration} disabled={!p.loaded} onSeek={p.seek} />
          <Times time={p.time} duration={p.duration} speed={p.speed} />
          <div className="row-ctl">
            <SpeedPill narrow />
            <SkipButton dir={-1} size={30} />
            <PlayButton small />
            <SkipButton dir={1} size={30} />
            <ReadAlongPill />
          </div>
        </div>
      </div>
    </div>
  );
}
