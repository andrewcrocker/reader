import { useEffect, useState } from 'react';
import { useAppData } from '../app/data';
import { back, openSheet, showSnack, type Sheet as SheetState } from '../app/ui';
import { addText, addUrl, replaceWithText, retryArticle } from '../pipeline/runner';
import { MAX_SPEED, MIN_SPEED, usePlayer } from '../player/PlayerProvider';
import { fmtDuration, fmtSpeed, hasRealTitle, lengthSec, siteLabel, urlTitle } from '../queue/display';
import { Art } from '../ui/Art';
import { Icon, StatusGlyph } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';

/** An http(s) URL, or undefined. */
export function asUrl(s: string): string | undefined {
  try {
    const u = new URL(s.trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const WPS = 2.5;

// ---------- §5 Add sheet ----------

export function AddSheet({ sheet }: { sheet: Extract<SheetState, { kind: 'add' }> }) {
  const [tab, setTab] = useState(sheet.tab);
  return (
    <Sheet label={sheet.replaceId ? 'Paste the full text' : 'Add to queue'}>
      {!sheet.replaceId && (
        <div className="seg" role="tablist" aria-label="Add a link or text">
          {(['link', 'text'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'link' ? 'Link' : 'Text'}
            </button>
          ))}
        </div>
      )}
      {tab === 'link' && !sheet.replaceId ? <LinkTab /> : <TextTab sheet={sheet} />}
    </Sheet>
  );
}

async function readClipboardUrl(): Promise<string | undefined> {
  const text = await navigator.clipboard.readText();
  return asUrl(text.match(/https?:\/\/\S+/)?.[0] ?? text);
}

function LinkTab() {
  const [clip, setClip] = useState<{ state: 'unknown' | 'none' | 'url'; url?: string }>({ state: 'unknown' });
  const [typed, setTyped] = useState('');
  const valid = asUrl(typed);

  // Preview the clipboard only if we may read it silently; otherwise reading waits for the tap.
  useEffect(() => {
    void navigator.permissions
      ?.query({ name: 'clipboard-read' as PermissionName })
      .then(async (p) => {
        if (p.state !== 'granted') return;
        const url = await readClipboardUrl();
        setClip(url ? { state: 'url', url } : { state: 'none' });
      })

      .catch(() => {});
  }, []);

  const save = async (url: string) => {
    await addUrl(url);
    back();
  };

  const paste = async () => {
    try {
      const url = clip.url ?? (await readClipboardUrl());
      if (url) return void save(url);
      setClip({ state: 'none' });
    } catch {
      setClip({ state: 'none' });
    }
  };

  return (
    <>
      <button className="paste-btn" disabled={clip.state === 'none'} onClick={() => void paste()}>
        <Icon name="clipboard" size={26} />
        <span style={{ minWidth: 0 }}>
          <span className="l1">Paste link</span>
          <span className="l2">{clip.state === 'url' ? clip.url!.replace(/^https?:\/\/(www\.)?/, '') : clip.state === 'none' ? 'No link on your clipboard' : 'From your clipboard'}</span>
        </span>
      </button>
      <div className="divider-label">or type it</div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save(valid);
        }}
      >
        <label htmlFor="link-input">Article link</label>
        <div className="input-row">
          <input id="link-input" className="input" type="url" inputMode="url" placeholder="https://" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <button className="btn primary" type="submit" disabled={!valid}>
            Add
          </button>
        </div>
      </form>
      <p className="hint">Tip: the fastest way is Share › Reader from any app. If a page won’t load, switch to Text and paste the article itself.</p>
    </>
  );
}

function TextTab({ sheet }: { sheet: Extract<SheetState, { kind: 'add' }> }) {
  const { settings } = useAppData();
  const [title, setTitle] = useState(sheet.title ?? '');
  const [text, setText] = useState(sheet.text ?? '');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const ok = words >= 3;

  const save = async () => {
    if (!ok) return;
    if (sheet.replaceId) {
      await replaceWithText(sheet.replaceId, text, title);
      back();
      showSnack({ text: 'Text replaced. Preparing the audio again.' });
    } else {
      await addText(text, title);
      back();
    }
  };

  return (
    <form
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {sheet.shared && (
        <p className="status-note" role="status">
          <Icon name="share" size={18} />
          Text shared from another app. Add a title, then save.
        </p>
      )}
      {sheet.replaceId && <p className="hint">Paste the whole article. It replaces what was found, and the audio is made again.</p>}
      <div className="field">
        <label htmlFor="title-input">Title (optional)</label>
        <input id="title-input" className="input" type="text" placeholder="Uses the first line if left blank" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="body-input">Article text</label>
        <textarea id="body-input" className="input" rows={9} value={text} onChange={(e) => setText(e.target.value)} autoFocus={!sheet.text} />
        <p className="hint tabular" style={{ fontSize: 12.5 }} aria-live="polite">
          {words ? `${words.toLocaleString()} words · about ${fmtDuration(words / WPS / settings.speed)} at ${fmtSpeed(settings.speed)}` : 'Paste or type the article.'}
        </p>
      </div>
      <button className="btn primary block" type="submit" disabled={!ok}>
        {sheet.replaceId ? 'Replace and save' : 'Save to queue'}
      </button>
    </form>
  );
}

// ---------- §8 Speed picker ----------

const PRESETS = [1, 1.25, 1.5, 1.75, 2];

export function SpeedSheet() {
  const p = usePlayer();
  const a = p.current;
  const left = a ? Math.max(0, p.duration - p.time) / p.speed : undefined;
  const pct = ((p.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100;
  const spoken = (v: number) => `${Number(v.toFixed(2))} times`;
  return (
    <Sheet label="Speed" wide head={false}>
      <div className="sheet-head">
        <h2 className="caps" style={{ margin: 0 }}>Speed</h2>
        {left !== undefined && <span className="hint tabular">This article: {fmtDuration(left)} left</span>}
      </div>
      <p className="speed-value" aria-hidden="true">{fmtSpeed(p.speed)}</p>
      <div className="speed-row">
        <button className="step" aria-label="Slower" disabled={p.speed <= MIN_SPEED} onClick={() => p.setSpeed(Math.round((p.speed - 0.1) * 10) / 10)}>
          <Icon name="minus" />
        </button>
        <input
          className="range"
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.1}
          value={p.speed}
          style={{ ['--fill-pct' as string]: `${pct}%` }}
          aria-label="Playback speed"
          aria-valuetext={spoken(p.speed)}
          onChange={(e) => p.setSpeed(Number(e.target.value))}
        />
        <button className="step" aria-label="Faster" disabled={p.speed >= MAX_SPEED} onClick={() => p.setSpeed(Math.round((p.speed + 0.1) * 10) / 10)}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="speed-ends" aria-hidden="true">
        <span>{fmtSpeed(MIN_SPEED)}</span>
        <span>{fmtSpeed(MAX_SPEED)}</span>
      </div>
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((v) => (
          <button key={v} className={`pill${Math.abs(p.speed - v) < 0.001 ? ' on' : ''}`} aria-pressed={Math.abs(p.speed - v) < 0.001} aria-label={spoken(v)} onClick={() => p.setSpeed(v)}>
            {Number.isInteger(v) ? v.toFixed(1) : v}

          </button>
        ))}
      </div>
      <p className="hint" style={{ textAlign: 'center' }}>Applies to everything you play, and stays set.</p>
    </Sheet>
  );
}

// ---------- §9 Partial / Failed explainer ----------

export function ExplainSheet({ id }: { id: string }) {
  const { articles, online } = useAppData();
  const player = usePlayer();
  const a = articles.find((x) => x.id === id);
  useEffect(() => {
    if (!a) back();
  }, [a]);
  if (!a) return null;
  const failed = a.status === 'failed';
  // A service failure never reached the page, so don't say the page couldn't load.
  const heading = !failed ? 'Only part of this article loaded' : a.errorKind === 'service' ? 'Couldn’t connect' : 'Couldn’t load this page';
  const urlish = !hasRealTitle(a) && a.source === 'url';
  const site = siteLabel(a);
  // Same speed-adjusted length the row shows ("6 m found").
  const foundSec = lengthSec(a);
  const foundMin = foundSec === undefined ? undefined : Math.max(1, Math.round(foundSec / player.speed / 60));
  const pasteText = () => openSheet({ kind: 'add', tab: 'text', title: hasRealTitle(a) ? a.title : undefined, replaceId: a.id });

  const original = a.url ? (
    <a className="btn outline block" href={a.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
      Open original
    </a>
  ) : null;

  return (
    <Sheet label={heading} head={false}>
      <div className="explain-head">
        <Art article={a} size={48} placeholder={urlish} />
        <div style={{ minWidth: 0 }}>
          <p className={`t${urlish ? ' url' : ''}`}>{urlish ? urlTitle(a.url) : a.title}</p>
          {site && <p className="hint">{site}</p>}
        </div>
      </div>
      <div className={`explain-body tone-${failed ? 'error' : 'warn'}`}>
        <span className="glyph" style={{ marginTop: 4 }}>
          <StatusGlyph kind={failed ? 'failed' : 'partial'} />
        </span>
        <div>
          <h2 style={{ color: 'var(--fg)' }}>{heading}</h2>
          <p>
            {failed
              ? a.error || 'Something went wrong preparing this article.'
              : `We found about ${foundMin ? `${foundMin} minute${foundMin === 1 ? '' : 's'}` : 'a few minutes'} of it. The rest is probably behind a sign-in or paywall.`}

          </p>
        </div>
      </div>
      {failed ? (
        <div className="stack">
          <button className="btn primary block" disabled={!online} onClick={() => void retryArticle(a.id).then(back)}>
            {!online && <Icon name="cloud-off" size={18} />}Retry
          </button>
          <button className="btn outline block" onClick={pasteText}>
            Paste the text
          </button>
          {original && <div style={{ display: 'flex' }}>{original}</div>}
        </div>
      ) : (
        <div className="stack">
          <button className="btn primary block" onClick={pasteText}>
            Paste the full text
          </button>
          {original && <div style={{ display: 'flex' }}>{original}</div>}
          <button
            className="btn ghost block"
            onClick={() => {
              back();
              player.play(a.id);
            }}
          >
            Play what’s here
          </button>
        </div>
      )}
    </Sheet>
  );
}
