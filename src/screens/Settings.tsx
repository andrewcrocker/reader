import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings, type Settings as S, type VoiceQuality } from '../db';
import { useAppData } from '../app/data';
import { back, openSheet, showSnack } from '../app/ui';
import { ensureVoiceModel, kick } from '../pipeline/runner';
import { usePlayer } from '../player/PlayerProvider';
import { archivedAudioBytes, clearAll, deleteArchivedAudio, exportQueue, importQueue, isRenderable, rerenderMany } from '../queue/actions';
import { fmtSpeed } from '../queue/display';
import { fmtBytes } from '../format';
import { QUALITY, VOICES } from '../tts/voices';
import { playSample } from '../tts/sample';
import { Icon } from '../ui/Icon';
import { Snackbar } from '../ui/Snackbar';
import { MiniPlayer } from './MiniPlayer';

const set = (patch: Partial<S>) => void updateSettings(patch);

function Seg<T extends string | number>({ label, value, options, onChange, full }: { label: string; value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={full ? 'seg' : 'seg compact'} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} disabled={o.disabled} onClick={() => onChange(o.v)} style={o.disabled ? { opacity: 0.5 } : undefined}>
          {o.label}
        </button>
      ))}
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

/** "High · Downloaded · 330 MB", "Standard · Downloading · 40 of 92 MB". */
export function qualityStatus(s: S): string {
  const q = QUALITY[s.voiceQuality];
  const m = s.voiceModel;
  const mine = m.quality === s.voiceQuality;
  if (mine && m.status === 'ready') return `Downloaded · ${q.mb} MB`;
  if (mine && m.status === 'downloading') {
    const total = m.totalBytes ? Math.round(m.totalBytes / 1e6) : q.mb;
    return `Downloading · ${Math.round((m.bytes ?? 0) / 1e6)} of ${total} MB`;
  }
  if (mine && m.status === 'error') return 'Download failed · tap to retry';
  return `Not downloaded · ${q.mb} MB`;
}

export function Settings() {
  const { settings: s, online, upNext } = useAppData();
  const player = usePlayer();
  const [moreVoices, setMoreVoices] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [sampling, setSampling] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usage = useLiveQuery(async () => {
    let audio = 0;
    let art = 0;
    await db.articles.each((a) => (audio += a.audioBytes ?? 0));
    await db.art.each((r) => (art += r.blob.size));
    return { audio, art, freeable: await archivedAudioBytes() };
  }, []);
  const voice = s.voiceModel.status === 'ready' ? s.voiceModel.totalBytes ?? QUALITY[s.voiceModel.quality ?? s.voiceQuality].mb * 1e6 : 0;
  const total = (usage?.audio ?? 0) + voice + (usage?.art ?? 0);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const voiceReady = s.voiceModel.status === 'ready';
  const voices = moreVoices ? VOICES : VOICES.slice(0, 2);

  const chooseQuality = (q: VoiceQuality) => {
    setQualityOpen(false);
    if (q === s.voiceQuality && s.voiceModel.status === 'ready') return;
    set({ voiceQuality: q });
    void ensureVoiceModel(q)
      .then(() => {
        void kick();
        const queued = upNext.filter((a) => isRenderable(a) && a.status === 'ready');
        if (queued.length) showSnack({ text: `Re-render ${queued.length} queued article${queued.length === 1 ? '' : 's'} with ${QUALITY[q].short}?`, actions: [{ label: 'Re-render', run: () => rerenderMany(queued.map((a) => a.id)) }] });
      })
      .catch(() => showSnack({ text: 'The voice download failed. Try again on Wi-Fi.' }));
  };

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

  const download = async () => {
    const blob = await exportQueue();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `read-aloud-queue-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const invite = async () => {
    const url = `${location.origin}/#invite=${encodeURIComponent(s.proxySecret)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Read-Aloud', text: 'Save articles and listen to them later.', url });
      else {
        await navigator.clipboard.writeText(url);
        showSnack({ text: 'Invite link copied' });
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const bars: [string, number, string][] = [
    ['Audio', usage?.audio ?? 0, 'var(--accent)'],
    ['Voice', voice, 'var(--storage-2)'],
    ['Art', usage?.art ?? 0, 'var(--input-border)'],
  ];

  return (
    <div className="screen">
      <div className="s-header">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          <Icon name="back" />
        </button>
        <h1>Settings</h1>
      </div>
      <div className="s-body">
        <h2 className="caps s-label">Voice</h2>
        <div role="radiogroup" aria-label="Voice">
          {voices.map((v) => (
            <div key={v.id} className="s-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minHeight: 64, cursor: 'pointer' }}>
                <input type="radio" name="voice" checked={s.voice === v.id} onChange={() => set({ voice: v.id })} />
                <span>
                  <span className="k">{v.name}</span>
                  <span className="d">{v.desc}</span>
                </span>
              </label>
              <button className="icon-btn filled" disabled={!voiceReady || sampling !== null} aria-label={voiceReady ? `Play a sample of ${v.name}` : `Sample of ${v.name}, available after the voice downloads`} onClick={() => void sample(v.id)}>
                <Icon name={sampling === v.id ? 'pause' : 'speaker'} size={20} />
              </button>
            </div>
          ))}
        </div>
        {!moreVoices && (
          <button className="s-row short" onClick={() => setMoreVoices(true)}>
            <span className="k">More voices</span>
            <span className="v">
              {VOICES.length - 2}
              <Icon name="chevron-right" size={18} />
            </span>
          </button>
        )}
        <button className="s-row" aria-expanded={qualityOpen} onClick={() => setQualityOpen((o) => !o)}>
          <span>
            <span className="k">Voice quality</span>
            <span className="d">{qualityStatus(s)}</span>
          </span>
          <span className="v">
            {QUALITY[s.voiceQuality].short}
            <Icon name="chevron-right" size={18} style={qualityOpen ? { transform: 'rotate(90deg)' } : undefined} />
          </span>
        </button>
        {qualityOpen && (
          <div role="radiogroup" aria-label="Voice quality">
            {(['high', 'standard'] as const).map((q) => (
              <label key={q} className="s-row short" style={{ justifyContent: 'flex-start', gap: 14, paddingLeft: 8, cursor: 'pointer' }}>
                <input type="radio" name="quality" checked={s.voiceQuality === q} disabled={!online && q !== s.voiceModel.quality} onChange={() => chooseQuality(q)} />
                <span>
                  <span className="k">{QUALITY[q].label}</span>
                  <span className="d">
                    {QUALITY[q].mb} MB · {QUALITY[q].desc}
                    {!online && q !== s.voiceModel.quality && ' · needs a connection'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="s-row pad">
          <span className="k">Engine</span>
          <div style={{ marginTop: 10 }}>
            <Seg full label="Engine" value={s.engineKind}
 options={[{ v: 'device', label: 'On this phone' }, { v: 'cloud', label: 'Cloud', disabled: true }]} onChange={(v) => set({ engineKind: v })} />
          </div>
          <span className="d" style={{ marginTop: 8 }}>Cloud voices use your own API key and need a connection. Not available yet.</span>
        </div>

        <h2 className="caps s-label">Playback</h2>
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

        <h2 className="caps s-label">Storage</h2>
        <div className="s-row pad" style={{ borderBottom: 0 }}>
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
        <button
          className="s-row"
          disabled={!usage?.freeable}
          onClick={() => void deleteArchivedAudio().then((n) => showSnack({ text: `Freed ${fmtBytes(n)}` }))}
        >
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
        <button className="s-row short danger" onClick={() => setConfirmClear(true)}>
          Clear all articles…
        </button>

        <h2 className="caps s-label">About</h2>
        <div className="s-row">
          <span>
            <span className="k">Invite a friend</span>
            <span className="d">{online ? 'Send a link to install the app' : 'Needs a connection'}</span>
          </span>
          <button className="chip-btn" disabled={!online} onClick={() => void invite()}>
            <Icon name="share" size={18} />
            Share
          </button>
        </div>
        <div className="s-row short" style={{ borderBottom: 0 }}>
          <span className="k">Version</span>
          <span className="v">{__APP_VERSION__}</span>
        </div>
      </div>

      <div className="dock">
        <Snackbar />
        <MiniPlayer />
      </div>

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
    </div>
  );
}
