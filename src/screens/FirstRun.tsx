import { useState, type ReactNode } from 'react';
import { updateSettings, type VoiceQuality } from '../db';
import { useAppData } from '../app/data';
import { isStandalone, promptInstall, useCanInstall } from '../app/install';
import { ensureVoiceModel, kick } from '../pipeline/runner';
import { domainColor, coverInk } from '../theme/color';
import { QUALITY } from '../tts/voices';
import { Icon } from '../ui/Icon';

/** "Downloading · 148 of 330 MB" and a rough time left from the observed rate. */
function useDownload() {
  const { settings } = useAppData();
  const m = settings.voiceModel;
  const [t0] = useState(() => ({ at: Date.now(), bytes: m.bytes ?? 0 }));
  const total = m.totalBytes ?? QUALITY[m.quality ?? settings.voiceQuality].mb * 1e6;
  const done = m.bytes ?? 0;
  const pct = m.status === 'ready' ? 100 : Math.min(99, Math.round((done / total) * 100));
  const rate = (done - t0.bytes) / Math.max(1, (Date.now() - t0.at) / 1000);
  const etaMin = rate > 0 ? Math.ceil((total - done) / rate / 60) : undefined;
  return { m, total, done, pct, eta: etaMin === undefined ? '' : etaMin <= 1 ? 'about a minute' : `about ${etaMin} min` };
}

const COVERS = [
  { domain: 'one', title: 'Saved for later', site: 'Your queue' },
  { domain: 'tide', title: 'Even offline', site: 'On this phone' },
  { domain: 'field', title: 'Read to you in a natural voice', site: 'Reader' },

];

function CoverStack() {
  const pos = [
    { left: 0, top: 30, size: 150, rotate: -6 },
    { right: 0, top: 20, size: 150, rotate: 5 },
    { left: '50%', top: 0, size: 190, rotate: 0, center: true },
  ];
  return (
    <div className="cover-stack" aria-hidden="true">
      {COVERS.map((c, i) => {
        const bg = domainColor(c.domain);
        const p = pos[i];
        return (
          <div
            key={i}
            className="cover"
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              left: p.left,
              right: p.right,
              top: p.top,
              padding: 16,
              background: bg,
              color: coverInk(bg),
              transform: `${p.center ? 'translateX(-50%) ' : ''}rotate(${p.rotate}deg)`,
            }}
          >
            <div className="cover-top" style={{ fontSize: 9 }}>
              <span>{c.site}</span>
            </div>
            <div>
              <div className="cover-rule" style={{ width: 28, marginBottom: 10 }} />
              <p className="cover-title" style={{ fontSize: p.size > 160 ? 22 : 17 }}>{c.title}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VoiceChip() {
  const { m, pct } = useDownload();
  if (m.status !== 'downloading') return null;
  return (
    <p className="status-chip" role="status">
      <Icon name="download" size={14} stroke={2} />
      Voice {pct}%
    </p>
  );
}

export function FirstRun() {
  const { settings, online } = useAppData();
  const canInstall = useCanInstall();
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<VoiceQuality>(settings.voiceQuality);
  const dl = useDownload();

  const start = (q: VoiceQuality) => {
    setChoice(q);
    if (!online) return;
    void updateSettings({ voiceQuality: q });
    // Rendering waits for this; kick the pipeline once it's in.
    void ensureVoiceModel(q).then(() => kick(), () => {});
  };

  const finish = () => void updateSettings({ onboarded: true });
  // Online voices need no download, so that step only exists for on-device voices.
  const order = settings.engineKind === 'server' ? [0, 2] : [0, 1, 2];
  const at = order.indexOf(step);
  const next = () => setStep(order[at + 1]);

  return (
    <div className="fr">
      <div className="fr-top">
        <div className="dots" role="img" aria-label={`Step ${at + 1} of ${order.length}`}>
          {order.map((_, i) => (
            <span key={i} className={i === at ? 'active' : i < at ? 'done' : undefined} />
          ))}
        </div>
        <VoiceChip />
      </div>

      {step === 0 && (
        <>
          <CoverStack />
          <h1 className="big">Articles, read aloud.</h1>
          <p className="lead">Save anything you mean to read. It’s turned into audio and kept on your phone, so it plays later on a walk, a commute, or with the dishes, even offline.</p>
          <div className="fr-foot">
            {canInstall && (
              <button className="btn primary large block" onClick={() => void promptInstall().then(next)}>
                Install the app
              </button>
            )}
            <button className={canInstall ? 'btn ghost block' : 'btn primary large block'} onClick={next}>
              {canInstall ? 'Continue in the browser' : 'Continue'}
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1>Download the voice</h1>
          <p className="lead">It runs on your phone, so what you listen to stays there. This is a one-time download. Wi-Fi is best.</p>
          <div role="radiogroup" aria-label="Voice quality" className="stack" style={{ marginTop: 24, gap: 12 }}>
            {(['high', 'standard'] as const).map((q) => {
              const on = choice === q;
              const active = on && dl.m.quality === q && (dl.m.status === 'downloading' || dl.m.status === 'ready');
              return (
                <label key={q} className={`q-card${on ? ' on' : ''}`} style={{ cursor: online ? 'pointer' : 'default' }}>
                  <span className="top">
                    <input type="radio" name="fr-quality" checked={on} disabled={!online} onChange={() => start(q)} style={{ width: 20, height: 20, accentColor: 'var(--accent)', margin: 0 }} />
                    <span style={{ flex: 1 }}>
                      <p className="name">
                        {QUALITY[q].label}
                        {q === 'high' && <small>Recommended</small>}
                      </p>
                      <p className="desc">
                        {QUALITY[q].mb} MB · {QUALITY[q].desc}
                      </p>
                    </span>
                  </span>
                  {active && (
                    <span>
                      <span className="dl-bar" role="progressbar" aria-valuenow={dl.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Voice download" style={{ display: 'block' }}>
                        <div style={{ width: `${dl.pct}%` }} />
                      </span>
                      <span className="dl-text">
                        <span>{dl.m.status === 'ready' ? 'Downloaded' : `Downloading · ${Math.round(dl.done / 1e6)} of ${Math.round(dl.total / 1e6)} MB`}</span>
                        <span>{dl.m.status === 'ready' ? '' : dl.eta}</span>
                      </span>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {online ? 'You can pick a different voice or quality later in Settings.' : 'You’re offline. Connect to download the voice; you can also do it later in Settings.'}
          </p>
          <div className="fr-foot">
            <button
              className="btn primary large block"
              onClick={() => {
                if (online && dl.m.status !== 'downloading' && dl.m.status !== 'ready') start(choice);
                next();
              }}
            >
              Continue
            </button>
            <p className="hint" style={{ textAlign: 'center' }}>The download keeps going in the background.</p>
          </div>
        </>
      )}

      {step === 2 && <SaveStep canInstall={canInstall} onDone={finish} />}
    </div>
  );
}

const appIcon = (
  <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 12, boxShadow: '0 0 0 3px var(--bg), 0 0 0 5px var(--accent)' }} />
    <span className="hint">Reader</span>
  </span>
);

const shareChip = (
  <span className="chip-btn" aria-hidden="true" style={{ display: 'inline-flex' }}>
    <Icon name="share" size={18} /> Share
  </span>
);

/**
 * Step 3, "Save from anywhere". Android only lists web apps in the share sheet once they're
 * installed, and iPhone never does, so the steps depend on where the app is running.
 */
function SaveStep({ canInstall, onDone }: { canInstall: boolean; onDone: () => void }) {
  const [installed, setInstalled] = useState(isStandalone);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const steps: { text: string; extra?: ReactNode }[] = ios
    ? [
        { text: 'In any app, copy the article’s link' },
        { text: 'Open Reader and tap +', extra: appIcon },
        { text: 'Tap Paste link. It’s in your queue.' },
      ]
    : installed
      ? [
          { text: 'In any app, tap Share', extra: shareChip },
          { text: 'Choose Reader', extra: appIcon },
          { text: 'It’s in your queue. Audio is ready in a few minutes.' },
        ]
      : [
          {
            text: 'Install the app',
            extra: canInstall ? (
              <button className="chip-btn" onClick={() => void promptInstall().then((ok) => ok && setInstalled(true))}>
                <Icon name="download" size={18} /> Install
              </button>
            ) : (
              <span className="hint">In Chrome’s ⋮ menu, tap Install app.</span>
            ),
          },
          { text: 'Then, in any app, tap Share and choose Reader', extra: appIcon },
          { text: 'It’s in your queue. Audio is ready in a few minutes.' },
        ];
  return (
    <>
      <h1>Save from anywhere</h1>
      <p className="lead">
        {ios
          ? 'iPhone doesn’t let web apps into the share sheet, so saving is a copy and a paste.'
          : installed
            ? 'When you find something to read later, send it here.'
            : 'Reader shows up in your share sheet once it’s installed.'}
      </p>
      <ol className="steps">
        {steps.map((st, i) => (
          <li key={i}>
            <span className="step-n">{i + 1}</span>
            <div>
              <p>{st.text}</p>
              {st.extra}
            </div>
          </li>
        ))}
      </ol>
      {!ios && <p className="hint" style={{ marginTop: 24 }}>You can also paste a link or text with the + button.</p>}
      <div className="fr-foot">
        <button className="btn primary large block" onClick={onDone}>
          Go to my queue
        </button>
      </div>
    </>
  );
}
