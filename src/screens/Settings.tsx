import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings, type Settings as S, type VoiceQuality } from '../db';
import { useAppData } from '../app/data';
import { back, openSettingsPage, openSheet, showSnack, useUi, type SettingsPage } from '../app/ui';
import { usePlayer } from '../player/PlayerProvider';
import { archivedAudioBytes, clearAll, deleteArchivedAudio, exportQueue, importQueue } from '../queue/actions';
import { fmtSpeed } from '../queue/display';
import { fmtBytes } from '../format';
import { QUALITY, VOICES } from '../tts/voices';
import { playSample } from '../tts/sample';
import { Icon } from '../ui/Icon';
import { Snackbar } from '../ui/Snackbar';
import { MiniPlayer } from './MiniPlayer';

const set = (patch: Partial<S>) => void updateSettings(patch);

type SegOption<T> = { v: T; label: string; disabled?: boolean; /** Tooltip on a disabled option, e.g. "Coming soon". */ tip?: string };

function Seg<T extends string | number>({ label, value, options, onChange, full }: { label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void; full?: boolean }) {
  // Touch has no hover, so tapping a disabled option shows its tip for a moment.
  const [tapped, setTapped] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={full ? 'seg' : 'seg compact'} role="radiogroup" aria-label={label}>
      {options.map((o) =>
        o.disabled ? (
          // aria-disabled rather than disabled: a disabled button gets no hover, so no tooltip.
          <button
            key={o.v}
            role="radio"
            aria-checked={false}
            aria-disabled="true"
            aria-description={o.tip}
            className={`seg-soon${tapped === o.v ? ' tip-on' : ''}`}
            data-tip={o.tip}
            onClick={() => {
              setTapped(o.v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setTapped(null), 1800);
            }}
          >
            {o.label}
          </button>
        ) : (
          <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ),
      )}
    </div>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** "Downloaded · 330 MB", "Downloading · 40 of 92 MB". */
export function qualityStatus(s: S, q: VoiceQuality = s.voiceQuality): string {
  const m = s.voiceModel;
  const mine = m.quality === q;
  if (mine && m.status === 'ready') return 'Downloaded';
  if (mine && m.status === 'downloading') {
    const total = m.totalBytes ? Math.round(m.totalBytes / 1e6) : QUALITY[q].mb;
    return `Downloading · ${Math.round((m.bytes ?? 0) / 1e6)} of ${total} MB`;
  }
  if (mine && m.status === 'error') return 'Download failed · choose it again to retry';
  return 'Not downloaded';
}

function useStorage() {
  const { settings: s } = useAppData();
  const usage = useLiveQuery(async () => {
    let audio = 0;
    let art = 0;
    await db.articles.each((a) => (audio += a.audioBytes ?? 0));
    await db.art.each((r) => (art += r.blob.size));
    return { audio, art, freeable: await archivedAudioBytes() };
  }, []);
  const voice = s.voiceModel.status === 'ready' ? s.voiceModel.totalBytes ?? QUALITY[s.voiceModel.quality ?? s.voiceQuality].mb * 1e6 : 0;
  return { usage, voice, total: (usage?.audio ?? 0) + voice + (usage?.art ?? 0) };
}

const TITLES: Record<SettingsPage, string> = { menu: 'Settings', voice: 'Voice', playback: 'Playback', storage: 'Storage' };

/** Settings: a menu of sections, each a pushed page (back returns to the menu). */
export function Settings() {
  const page = useUi().settings ?? 'menu';
  const body = useRef<HTMLDivElement>(null);
  // Each page starts at the top, and focus moves to its heading for screen readers.
  useEffect(() => {
    window.scrollTo(0, 0);
    body.current?.parentElement?.querySelector<HTMLElement>('.s-header h1')?.focus();
  }, [page]);
  return (
    <div className="screen">
      <div className="s-header">
        <button className="icon-btn" aria-label={page === 'menu' ? 'Back to queue' : 'Back to settings'} onClick={back}>
          <Icon name="back" />
        </button>
        <h1 tabIndex={-1}>{TITLES[page]}</h1>
      </div>
      <div className="s-body" ref={body}>
        {page === 'menu' && <Menu />}
        {page === 'voice' && <VoicePage />}
        {page === 'playback' && <PlaybackPage />}
        {page === 'storage' && <StoragePage />}
      </div>
      <div className="dock">
        <Snackbar />
        <MiniPlayer />
      </div>
    </div>
  );
}

function MenuRow({ label, summary, onClick }: { label: string; summary: string; onClick: () => void }) {
  return (
    <button className="s-row" onClick={onClick}>
      <span>
        <span className="k">{label}</span>
        <span className="d">{summary}</span>
      </span>
      <Icon name="chevron-right" size={20} style={{ color: 'var(--muted)' }} />
    </button>
  );
}

function Menu() {
  const { settings: s, online } = useAppData();
  const player = usePlayer();
  const { total } = useStorage();
  const voice = VOICES.find((v) => v.id === s.voice)?.name ?? s.voice;

  const invite = async () => {
    const url = `${location.origin}/#invite=${encodeURIComponent(s.proxySecret)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Reader', text: 'Save articles and listen to them later.', url });
      else {
        await navigator.clipboard.writeText(url);
        showSnack({ text: 'Invite link copied' });
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <div className="s-menu">
      <nav aria-label="Settings sections" style={{ marginTop: 8 }}>
        <MenuRow label="Voice" summary={voice} onClick={() => openSettingsPage('voice')} />
        <MenuRow label="Playback" summary={`${fmtSpeed(player.speed)} · skip ${s.skipSeconds}s · auto-advance ${s.autoAdvance ? 'on' : 'off'}`} onClick={() => openSettingsPage('playback')} />
        <MenuRow label="Storage" summary={`${fmtBytes(total)} used`} onClick={() => openSettingsPage('storage')} />
      </nav>
      <button className="btn outline block" style={{ marginTop: 28 }} disabled={!online} onClick={() => void invite()}>
        <Icon name="share" size={18} />
        Invite a friend
      </button>
      <p className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
        {online ? 'Sends a link to install the app.' : 'Inviting needs a connection.'}
      </p>
      <p className="hint tabular s-version">Version {__APP_VERSION__}</p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="caps s-label">{label}</h2>
      {children}
    </section>
  );
}

// ---------- Voice ----------

function VoicePage() {
  const { settings: s } = useAppData();
  const [sampling, setSampling] = useState<string | null>(null);

  const sample = async (id: string) => {
    setSampling(id);
    try {
      await playSample(id);
    } catch {
      showSnack({ text: 'Couldn’t play a sample.' });
    } finally {
      setSampling(null);
    }
  };

  return (
    <Section label="Voice">
      <div role="radiogroup" aria-label="Voice">
        {VOICES.map((v) => (
          <div key={v.id} className="s-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minHeight: 64, cursor: 'pointer' }}>
              <input type="radio" name="voice" checked={s.voice === v.id} onChange={() => set({ voice: v.id })} />
              <span>
                <span className="k">{v.name}</span>
                <span className="d">{v.desc}</span>
              </span>
            </label>
            <button className="icon-btn filled" disabled={sampling !== null} aria-label={`Play a sample of ${v.name}`} onClick={() => void sample(v.id)}>
              <Icon name={sampling === v.id ? 'pause' : 'speaker'} size={20} />
            </button>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>New articles use the voice you pick.</p>
    </Section>
  );
}

// ---------- Playback ----------

function PlaybackPage() {
  const { settings: s } = useAppData();
  const player = usePlayer();
  return (
    <div style={{ marginTop: 8 }}>
      <button className="s-row short" onClick={() => openSheet({ kind: 'speed' })}>
        <span className="k">Speed</span>
        <span className="v">
          {fmtSpeed(player.speed)}
          <Icon name="chevron-right" size={18} />
        </span>
      </button>
      <div className="s-row short">
        <span className="k">Skip interval</span>
        <Seg label="Skip interval" value={s.skipSeconds} options={[10, 15, 30].map((n) => ({ v: n as 10 | 15 | 30, label: `${n}s` }))} onChange={(v) => set({ skipSeconds: v })} />
      </div>
      <div className="s-row">
        <span>
          <span className="k">Auto-advance</span>
          <span className="d">Play the next article when one ends</span>
        </span>
        <Switch on={s.autoAdvance} label="Auto-advance" onChange={(v) => set({ autoAdvance: v })} />
      </div>
      <div className="s-row">
        <span>
          <span className="k">When an article finishes</span>
          <span className="d">{s.keepPlayed === 'archive' ? 'Moves to Archive, where you can replay it' : 'Deleted with its audio'}</span>
        </span>
        <Seg label="When an article finishes" value={s.keepPlayed} options={[{ v: 'archive', label: 'Archive' }, { v: 'delete', label: 'Delete' }]} onChange={(v) => set({ keepPlayed: v })} />
      </div>
    </div>
  );
}

// ---------- Storage ----------

function StoragePage() {
  const { usage, voice, total } = useStorage();
  const [confirmClear, setConfirmClear] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const download = async () => {
    const blob = await exportQueue();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `read-aloud-queue-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const bars: [string, number, string][] = [
    ['Audio', usage?.audio ?? 0, 'var(--accent)'],
    ['Voice', voice, 'var(--storage-2)'],
    ['Art', usage?.art ?? 0, 'var(--input-border)'],
  ];

  return (
    <>
      <div className="s-row pad" style={{ borderBottom: 0, marginTop: 8 }}>
        <p className="storage-total">
          {fmtBytes(total)} <small>used</small>
        </p>
        <div className="storage-bar" aria-hidden="true">
          {bars.map(([k, n, c]) => (n > 0 ? <div key={k} style={{ flex: n, background: c }} /> : null))}
        </div>
        <div className="legend">
          {bars.map(([k, n, c], i) => (
            <span key={k}>
              <svg width="10" height="10" aria-hidden="true">
                {i === 0 ? <rect width="10" height="10" rx="2" fill={c} /> : i === 1 ? <circle cx="5" cy="5" r="5" fill={c} /> : <path d="M5 0l5 10H0z" fill={c} />}
              </svg>
              {k} {fmtBytes(n)}
            </span>
          ))}
        </div>
      </div>
      <div className="s-row">
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ color: persisted ? 'var(--accent)' : 'var(--warn)' }}>
            <Icon name={persisted ? 'shield' : 'warn'} />
          </span>
          <span>
            <span className="k">{persisted ? 'Storage is protected' : 'Storage isn’t protected'}</span>
            <span className="d">{persisted ? 'Your phone won’t clear these files to free up space.' : 'Your phone may clear audio when it’s low on space.'}</span>
          </span>
        </span>
        {persisted === false && (
          <button className="chip-btn" onClick={() => void navigator.storage.persist().then(setPersisted)}>
            Allow
          </button>
        )}
      </div>
      <button className="s-row" disabled={!usage?.freeable} onClick={() => void deleteArchivedAudio().then((n) => showSnack({ text: `Freed ${fmtBytes(n)}` }))}>
        <span>
          <span className="k">Delete audio for archived articles</span>
          <span className="d">{usage?.freeable ? `Frees about ${fmtBytes(usage.freeable)} · text is kept` : 'Nothing to free · text is kept'}</span>
        </span>
      </button>
      <button className="s-row short" onClick={() => void download()}>
        <span className="k">Export queue</span>
        <Icon name="download" />
      </button>
      <button className="s-row short" onClick={() => fileRef.current?.click()}>
        <span className="k">Import queue</span>
        <Icon name="upload" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const n = await importQueue(await f.text());
            showSnack({ text: n ? `Imported ${n} article${n === 1 ? '' : 's'}` : 'Nothing new to import' });
          } catch (err) {
            showSnack({ text: err instanceof Error ? err.message : 'Import failed' });
          }
        }}
      />
      <button className="s-row short danger" style={{ borderBottom: 0 }} onClick={() => setConfirmClear(true)}>
        Clear all articles…
      </button>

      {confirmClear && (
        <>
          <div className="scrim" style={{ zIndex: 50 }} onClick={() => setConfirmClear(false)} aria-hidden="true" />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" aria-describedby="clear-desc">
            <h2 id="clear-title">Clear all articles?</h2>
            <p id="clear-desc">This deletes every article in Up next and Archive, with its audio. It can’t be undone.</p>
            <div className="actions">
              <button className="text-btn" autoFocus onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                className="text-btn"
                style={{ color: 'var(--error)' }}
                onClick={() => {
                  setConfirmClear(false);
                  void clearAll().then(() => showSnack({ text: 'All articles cleared' }));
                }}
              >
                Clear all
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
