import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings, type EnginePref, type Settings } from '../db';
import { VOICES } from '../tts/voices';
import { audioBackend } from '../audio/storage';
import { fmtBytes } from '../format';

export function SettingsPanel({ settings }: { settings: Settings }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number } | null>(null);
  const [backend, setBackend] = useState<string>('…');
  const audioTotal = useLiveQuery(async () => {
    let n = 0;
    await db.articles.each((a) => { n += a.audioBytes ?? 0; });
    return n;
  }, []);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then(setUsage).catch(() => {});
    void audioBackend().then(setBackend);
  }, []);

  return (
    <section className="card">
      <h2>Settings</h2>
      <div className="grid2">
        <label>
          Proxy URL
          <input value={settings.proxyUrl} onChange={(e) => updateSettings({ proxyUrl: e.target.value })} placeholder="https://reader-proxy.example.workers.dev" />
        </label>
        <label>
          Proxy secret
          <input type="password" value={settings.proxySecret} onChange={(e) => updateSettings({ proxySecret: e.target.value })} autoComplete="off" />
        </label>
        <label>
          Voice (new articles)
          <select value={settings.voice} onChange={(e) => updateSettings({ voice: e.target.value })}>
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label>
          TTS backend
          <select value={settings.engine} onChange={(e) => updateSettings({ engine: e.target.value as EnginePref })}>
            <option value="auto">Auto (WebGPU → WASM)</option>
            <option value="webgpu">WebGPU</option>
            <option value="wasm">WASM</option>
          </select>
        </label>
        <label>
          Skip interval
          <select value={settings.skipSeconds} onChange={(e) => updateSettings({ skipSeconds: Number(e.target.value) })}>
            <option value={15}>15 s</option>
            <option value={30}>30 s</option>
          </select>
        </label>
      </div>
      <p className="small muted">
        Storage persisted: <strong>{persisted === null ? 'unknown' : persisted ? 'yes' : 'no'}</strong> · Audio in{' '}
        {backend} · Audio total {fmtBytes(audioTotal ?? 0)}
        {usage?.usage !== undefined && ` · Site usage ${fmtBytes(usage.usage)} of ${fmtBytes(usage.quota ?? 0)}`}
      </p>
      {persisted === false && (
        <button onClick={() => navigator.storage.persist().then(setPersisted)}>Request persistent storage</button>
      )}
    </section>
  );
}
