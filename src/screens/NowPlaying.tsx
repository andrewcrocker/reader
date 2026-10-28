import { useRef } from 'react';
import { useAppData } from '../app/data';
import { back, getUi } from '../app/ui';
import { updateSettings, type Article } from '../db';

import { usePlayer } from '../player/PlayerProvider';
import { displayState, hasRealTitle, rowMeta, siteLabel, urlTitle, voiceReady } from '../queue/display';

import { Art, Cover } from '../ui/Art';
import { Icon } from '../ui/Icon';
import { Scrubber, Times } from '../ui/Scrubber';
import { Snackbar } from '../ui/Snackbar';
import { Lyrics } from './Lyrics';
import { PlayButton, ReadAlongPill, SkipButton, SpeedPill } from './Transport';

/**
 * DESIGN §3 (and §4 when Read along is on). `embedded` is the right pane of the wide layout: always
 * open, so no collapse control, swipe-down, or snackbar of its own (the queue pane shows it).
 */
export function NowPlaying({ embedded }: { embedded?: boolean }) {
  const p = usePlayer();
  const { settings, online, upNext } = useAppData();
  const drag = useRef<{ y: number; at: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const a = p.current;
  if (!a) return null;
  if (settings.lyricsOn) return <Lyrics embedded={embedded} />;

  const byline = [a.byline, siteLabel(a)].filter(Boolean).join(' · ');
  // Still rendering: either playing what's rendered so far (streaming) or waiting for the first part.
  const renderingNow = p.streaming || (!p.loaded && (a.status === 'rendering' || a.status === 'extracted'));
  const rendered = p.streaming ? (p.duration ? p.renderedUntil / p.duration : 0) : renderingNow ? a.renderProgress ?? 0 : 1;
  const pct = Math.round((a.renderProgress ?? 0) * 100);
  // The peek shows the next row whatever its state; auto-advance skips ones that can't play yet.
  const next = upNext.find((x) => x.id !== a.id && x.queueOrder > a.queueOrder) ?? (a.archivedAt ? upNext[0] : undefined);

  const nextMeta = next ? rowMeta(next, displayState(next, { online, voiceReady: voiceReady(settings), speed: p.speed }), { online, voiceReady: voiceReady(settings), speed: p.speed }) : undefined;

  // Swipe down from the top of the page collapses.
  const onDown = (e: React.PointerEvent) => {
    if (embedded) return;
    if ((sheetRef.current?.scrollTop ?? 0) <= 0 && !(e.target as HTMLElement).closest('.scrubber, button, a')) drag.current = { y: e.clientY, at: Date.now() };
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current && e.clientY - drag.current.y > 90) {
      drag.current = null;
      if (getUi().nowPlaying) back();
    }
  };

  return (
    <div className={`np${embedded ? ' embedded' : ''}`} ref={sheetRef} role={embedded ? 'region' : 'dialog'} aria-label="Now playing" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <div className="np-inner">
        <div className="np-top">
          {embedded ? (
            <span className="icon-btn" aria-hidden="true" />
          ) : (
            <button className="icon-btn" aria-label="Collapse player" onClick={back}>
              <Icon name="chevron-down" size={26} />
            </button>
          )}
          <p className="caps" style={{ letterSpacing: '0.1em', margin: 0 }}>From your queue</p>
          {a.url ? (
            <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" aria-label="Open original article">
              <Icon name="external" />
            </a>
          ) : (
            <span className="icon-btn" aria-hidden="true" />
          )}
        </div>
        <div className="np-cover">
          <Cover article={a} />
        </div>
        <div className="np-meta">
          <h1 className="np-title">{a.title}</h1>
          {byline && <p className="np-byline">{byline}</p>}
        </div>
        <div className="np-scrub">
          <Scrubber time={p.time} duration={p.duration} rendered={rendered} disabled={!p.loaded} onSeek={p.seek} />
          <Times
            time={p.time}
            duration={p.duration}
            speed={p.speed}
            center={p.streaming && p.waiting && p.playing ? 'Preparing the next part…' : renderingNow ? `Preparing audio · ${pct}%` : undefined}
          />

        </div>
        <div className="transport">
          <button className="t-btn" disabled={!p.loaded} aria-label="Previous sentence" onClick={() => p.sentence(-1)}>
            <Icon name="prev-sentence" size={26} />
          </button>
          <SkipButton dir={-1} />
          <PlayButton />
          <SkipButton dir={1} />
          <button className="t-btn" disabled={!p.loaded} aria-label="Next sentence" onClick={() => p.sentence(1)}>
            <Icon name="next-sentence" size={26} />
          </button>
        </div>
        <div className="pills">
          <SpeedPill />
          <button
            className={`pill icon${settings.autoAdvance ? ' on' : ''}`}
            aria-pressed={settings.autoAdvance}
            aria-label="Auto-advance"
            onClick={() => void updateSettings({ autoAdvance: !settings.autoAdvance })}
          >
            <Icon name="auto-advance" stroke={2} />
          </button>
          <ReadAlongPill>Read along</ReadAlongPill>
        </div>
        <div className="np-spacer" />
        {!embedded && <Snackbar />}
        {next && nextMeta && (
          <div className="np-peek">
            <p className="caps" style={{ margin: '0 0 8px' }}>Up next</p>
            {/* Tap opens the queue; in the wide layout the queue is already beside it. */}
            {embedded ? (
              <div className="peek-row">{peekBody(next, nextMeta.segs)}</div>
            ) : (
              <button onClick={back} aria-label={`Up next: ${nextMeta.spoken}. Open the queue`}>
                {peekBody(next, nextMeta.segs)}
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function peekBody(next: Article, segs: { text: string }[]) {
  return (
    <>
      <Art article={next} size={40} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <p className="peek-title">{hasRealTitle(next) ? next.title : urlTitle(next.url)}</p>
        <p className="peek-sub">{segs.map((s) => s.text).join(' · ')}</p>
      </span>
    </>
  );
}
