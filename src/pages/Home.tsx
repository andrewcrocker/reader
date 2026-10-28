import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS, getSettings, updateSettings, type Article } from '../db';
import { addText, addUrl, deleteArticle, onEngineState, retryArticle, startRunner, type EngineState } from '../pipeline/runner';
import { fmtBytes, fmtTime } from '../format';
import { Player } from './Player';
import { SettingsPanel } from './SettingsPanel';

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  const s = await getSettings();
  if (!s.persistRequested) {
    // §11a: ask once on first launch; Chrome usually grants this to installed PWAs.
    await navigator.storage?.persist?.().catch(() => false);
    await updateSettings({ persistRequested: true });
  }
  startRunner();
}

export function Home() {
  const settings = useLiveQuery(() => getSettings(), []) ?? DEFAULT_SETTINGS;
  const articles = useLiveQuery(() => db.articles.orderBy('queueOrder').toArray(), []) ?? [];
  const [showSettings, setShowSettings] = useState(false);
  const [engine, setEngine] = useState<EngineState>({ phase: 'idle' });

  useEffect(() => {
    void boot();
    return onEngineState(setEngine);
  }, []);

  const current = articles.find((a) => a.id === settings.lastPlayingArticleId);

  return (
    <main className="page">
      <header className="topbar">
        <h1>Reader</h1>
        <nav className="row">
          <a href="/spike">TTS spike</a>
          <button onClick={() => setShowSettings((v) => !v)}>{showSettings ? 'Close' : 'Settings'}</button>
        </nav>
      </header>

      {showSettings && <SettingsPanel settings={settings} />}

      {current && <Player key={current.id} article={current} settings={settings} />}

      <AddForm />

      <EngineLine state={engine} />

      <section className="list">
        {articles.length === 0 && <p className="muted">Nothing saved yet. Paste a URL or some text above.</p>}
        {articles.map((a) => (
          <ArticleRow key={a.id} article={a} active={a.id === current?.id} />
        ))}
      </section>
    </main>
  );
}

function AddForm() {
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function pasteUrl() {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      const found = clip.match(/https?:\/\/\S+/)?.[0];
      if (found) {
        await addUrl(found);
        setMsg('Added from clipboard.');
      } else {
        setUrl(clip);
        setMsg('Clipboard does not contain a URL.');
      }
    } catch {
      setMsg('Clipboard access was blocked. Paste into the field instead.');
    }
  }

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      await addUrl(u.toString());
      setUrl('');
      setMsg(null);
    } catch {
      setMsg('That does not look like a web address.');
    }
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().split(/\s+/).length < 3) return setMsg('Paste a bit more text.');
    await addText(text, title);
    setText('');
    setTitle('');
    setMsg(null);
  }

  return (
    <section className="card">
      <div className="tabs">
        <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>URL</button>
        <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>Text</button>
      </div>
      {mode === 'url' ? (
        <>
          <button className="primary full" onClick={pasteUrl}>Paste URL from clipboard</button>
          <form className="row" onSubmit={submitUrl}>
            <input className="grow" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" disabled={!url.trim()}>Add</button>
          </form>
        </>
      ) : (
        <form className="stack" onSubmit={submitText}>
          <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={6} placeholder="Paste the article text here" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="primary" type="submit" disabled={!text.trim()}>Add text</button>
        </form>
      )}
      {msg && <p className="small muted">{msg}</p>}
    </section>
  );
}

function EngineLine({ state }: { state: EngineState }) {
  if (state.phase === 'idle') return null;
  if (state.phase === 'ready') {
    return (
      <p className="small muted">
        Voice engine: {state.device} ({state.dtype}){state.fallbackReason && ` · ${state.fallbackReason}`}
      </p>
    );
  }
  if (state.phase === 'error') return <p className="small error">Voice engine failed: {state.message}</p>;
  return (
    <p className="small muted">
      {state.message}
      {state.total ? ` ${fmtBytes(state.loaded ?? 0)} / ${fmtBytes(state.total)}` : ''}
    </p>
  );
}

const STATUS_LABEL: Record<Article['status'], string> = {
  fetching: 'Fetching',
  extracted: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  partial: 'Partial',
  failed: 'Failed',
};

function ArticleRow({ article: a, active }: { article: Article; active: boolean }) {
  const listened = a.durationSec ? Math.min(1, a.positionSec / a.durationSec) : 0;
  const offlineWaiting = a.status === 'fetching' && !navigator.onLine;
  return (
    <article className={`row-item ${active ? 'active' : ''}`}>
      <button
        className="row-main"
        onClick={() => updateSettings({ lastPlayingArticleId: a.id })}
        aria-label={`Open ${a.title}`}
      >
        <div className="row-title">{a.title}</div>
        <div className="small muted">
          {[a.siteName, a.durationSec ? fmtTime(a.durationSec) : null, a.playedAt ? 'Played' : null].filter(Boolean).join(' · ')}
        </div>
        {listened > 0 && <div className="bar"><div style={{ width: `${listened * 100}%` }} /></div>}
        {a.error && <div className="small error">{a.error}</div>}
      </button>
      <div className="row-side">
        <span className={`chip ${a.status}`}>
          {offlineWaiting ? 'Waiting for network' : STATUS_LABEL[a.status]}
          {a.status === 'rendering' && ` ${Math.round((a.renderProgress ?? 0) * 100)}%`}
        </span>
        <div className="row">
          {a.status === 'failed' && <button className="small" onClick={() => retryArticle(a.id)}>Retry</button>}
          <button className="small" onClick={() => confirm(`Delete “${a.title}”?`) && deleteArticle(a.id)} aria-label="Delete">✕</button>
        </div>
      </div>
    </article>
  );
}
