import { useEffect, useRef, useState } from 'react';
import { KokoroEngine, type Dtype, type LoadInfo } from '../tts/engine';
import { VOICES } from '../tts/voices';
import { buildScript, introBlock, type Block } from '../pipeline/textprep';
import { floatToInt16, silence, wavBlob } from '../audio/pcm';
import { encodeMp3, MP3_KBPS } from '../audio/encode';
import { fmtBytes, fmtMs, fmtTime } from '../format';
import { QUICK_BLOCKS, SAMPLE_BLOCKS, SAMPLE_BYLINE, SAMPLE_SITE, SAMPLE_TITLE } from '../spike/sample';
import type { EnginePref } from '../db';

// Phase 0 spike (§6.3): how fast is on-device Kokoro on this phone?

type Chunking = 'sentence' | 'grouped';

interface RunResult {
  at: string;
  device: string;
  dtype: string;
  cached: boolean;
  fallbackReason?: string;
  crossOriginIsolated: boolean;
  cores: number;
  voice: string;
  chunking: Chunking;
  words: number;
  chunks: number;
  loadMs: number;
  firstAudioMs: number;
  renderMs: number;
  audioSec: number;
  rtf: number;
  chunkMsMedian: number;
  chunkMsP90: number;
  mp3EncodeMs?: number;
  mp3Bytes?: number;
  wavBytes: number;
  ua: string;
}

const HISTORY_KEY = 'spike-history';

function loadHistory(): RunResult[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveHistory(h: RunResult[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 30)));
  } catch {
    /* storage unavailable */
  }
}

function pct(sorted: number[], p: number) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
}

export function Spike() {
  const [pref, setPref] = useState<EnginePref>('auto');
  const [gpuDtype, setGpuDtype] = useState<Dtype>('fp32');
  const [wasmDtype, setWasmDtype] = useState<Dtype>('q8');
  const [voice, setVoice] = useState<string>('af_heart');
  const [chunking, setChunking] = useState<Chunking>('sentence');
  const [quick, setQuick] = useState(false);

  const [status, setStatus] = useState('Idle');
  const [download, setDownload] = useState<{ file: string; loaded: number; total: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; renderMs: number; audioSec: number; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [history, setHistory] = useState<RunResult[]>(loadHistory);

  const engineRef = useRef<{ engine: KokoroEngine; key: string; info: LoadInfo } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopRef = useRef(false);

  useEffect(() => () => engineRef.current?.engine.dispose(), []);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => () => { if (wavUrl) URL.revokeObjectURL(wavUrl); }, [wavUrl]);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      audioRef.current.preservesPitch = true;
    }
  }, [rate, audioUrl]);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setAudioUrl(null);
    setWavUrl(null);
    stopRef.current = false;
    const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);

    try {
      // Reuse the loaded model when backend settings haven't changed, so voice comparisons are quick.
      const key = `${pref}|${gpuDtype}|${wasmDtype}`;
      let loaded = engineRef.current?.key === key ? engineRef.current : null;
      if (!loaded) {
        engineRef.current?.engine.dispose();
        engineRef.current = null;
        const engine = new KokoroEngine();
        setStatus('Loading model…');
        const info = await engine.load(pref, { gpuDtype, wasmDtype }, {
          onStatus: setStatus,
          onProgress: (file, l, t) => setDownload({ file, loaded: l, total: t }),
        });
        setDownload(null);
        loaded = { engine, key, info };
        engineRef.current = loaded;
      }
      const { engine, info } = loaded;

      const source = quick ? QUICK_BLOCKS : SAMPLE_BLOCKS;
      const blocks: Block[] = [introBlock({ title: SAMPLE_TITLE, byline: SAMPLE_BYLINE, siteName: SAMPLE_SITE })!, ...source];
      const words = source.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
      const script = buildScript(blocks, {
        maxSentencesPerChunk: chunking === 'sentence' ? 1 : 3,
        maxChars: engine.maxCharsPerRequest,
      });

      setStatus(`Rendering on ${info.device} (${info.dtype})…`);
      const parts: Int16Array[] = [];
      const chunkMs: number[] = [];
      let audioSec = 0;
      let firstAudioMs = 0;
      const t0 = performance.now();
      for (const chunk of script.chunks) {
        if (stopRef.current) throw new Error('Stopped');
        setProgress({ done: chunk.i, total: script.chunks.length, renderMs: performance.now() - t0, audioSec, text: chunk.text });
        const { pcm, sampleRate, ms } = await engine.synthesize(chunk.text, voice);
        if (!firstAudioMs) firstAudioMs = performance.now() - t0;
        chunkMs.push(ms);
        parts.push(floatToInt16(pcm), silence(chunk.pauseAfter, sampleRate));
        audioSec += pcm.length / sampleRate + chunk.pauseAfter;
      }
      const renderMs = performance.now() - t0;
      setProgress({ done: script.chunks.length, total: script.chunks.length, renderMs, audioSec, text: '' });

      const wav = wavBlob(parts, 24_000);
      setWavUrl(URL.createObjectURL(wav));

      setStatus('Encoding MP3…');
      let mp3EncodeMs: number | undefined;
      let mp3Bytes: number | undefined;
      let playable: Blob = wav;
      try {
        const e0 = performance.now();
        const mp3 = await encodeMp3(parts, 24_000);
        mp3EncodeMs = performance.now() - e0;
        mp3Bytes = mp3.size;
        playable = mp3;
      } catch (err) {
        console.warn('MP3 encode failed', err);
      }
      setAudioUrl(URL.createObjectURL(playable));

      const sorted = [...chunkMs].sort((a, b) => a - b);
      const r: RunResult = {
        at: new Date().toISOString(),
        device: info.device,
        dtype: info.dtype,
        cached: info.cached,
        fallbackReason: info.fallbackReason,
        crossOriginIsolated: info.crossOriginIsolated,
        cores: navigator.hardwareConcurrency ?? 0,
        voice,
        chunking,
        words,
        chunks: script.chunks.length,
        loadMs: info.loadMs,
        firstAudioMs,
        renderMs,
        audioSec,
        rtf: renderMs / 1000 / audioSec,
        chunkMsMedian: pct(sorted, 0.5),
        chunkMsP90: pct(sorted, 0.9),
        mp3EncodeMs,
        mp3Bytes,
        wavBytes: wav.size,
        ua: navigator.userAgent,
      };
      setResult(r);
      setHistory((h) => {
        const next = [r, ...h];
        saveHistory(next);
        return next;
      });
      setStatus('Done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('Failed');
      if (msg !== 'Stopped') {
        engineRef.current?.engine.dispose();
        engineRef.current = null;
      }
    } finally {
      setRunning(false);
      await wakeLock?.release().catch(() => {});
    }
  }

  function copyResults() {
    navigator.clipboard?.writeText(JSON.stringify(history, null, 2)).catch(() => {});
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>TTS spike</h1>
        <a href="/">← App</a>
      </header>
      <p className="muted">
        Renders a ~1,000-word sample with Kokoro-82M on this device. The first run downloads the model (≈90 MB for q8,
        ≈330 MB for fp32); later runs load from cache. Keep the screen on while it renders.
      </p>

      <section className="card">
        <div className="grid2">
          <label>
            Backend
            <select value={pref} onChange={(e) => setPref(e.target.value as EnginePref)} disabled={running}>
              <option value="auto">Auto (WebGPU → WASM)</option>
              <option value="webgpu">WebGPU only</option>
              <option value="wasm">WASM only</option>
            </select>
          </label>
          <label>
            Voice
            <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={running}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
          <label>
            WebGPU precision
            <select value={gpuDtype} onChange={(e) => setGpuDtype(e.target.value as Dtype)} disabled={running}>
              <option value="fp32">fp32 (recommended)</option>
              <option value="fp16">fp16</option>
            </select>
          </label>
          <label>
            WASM precision
            <select value={wasmDtype} onChange={(e) => setWasmDtype(e.target.value as Dtype)} disabled={running}>
              <option value="q8">q8 (recommended)</option>
              <option value="q4">q4</option>
              <option value="fp32">fp32</option>
            </select>
          </label>
          <label>
            Chunking
            <select value={chunking} onChange={(e) => setChunking(e.target.value as Chunking)} disabled={running}>
              <option value="sentence">One sentence per request</option>
              <option value="grouped">Up to 3 sentences (app default)</option>
            </select>
          </label>
          <label>
            Length
            <select value={quick ? 'quick' : 'full'} onChange={(e) => setQuick(e.target.value === 'quick')} disabled={running}>
              <option value="full">Full (~950 words)</option>
              <option value="quick">Quick (~150 words)</option>
            </select>
          </label>
        </div>
        <div className="row">
          {!running ? (
            <button className="primary" onClick={run}>Run</button>
          ) : (
            <button onClick={() => (stopRef.current = true)}>Stop</button>
          )}
          <span className="muted">{status}</span>
        </div>
        <p className="muted small">
          crossOriginIsolated: {String(self.crossOriginIsolated)} · cores: {navigator.hardwareConcurrency} · WebGPU API:{' '}
          {String('gpu' in navigator)}
        </p>
        {download && (
          <div>
            <progress value={download.loaded} max={download.total || 1} />
            <span className="small muted">
              {download.file.split('/').pop()}: {fmtBytes(download.loaded)} / {fmtBytes(download.total)}
            </span>
          </div>
        )}
        {progress && (
          <div>
            <progress value={progress.done} max={progress.total} />
            <div className="small muted">
              Chunk {progress.done}/{progress.total} · {fmtMs(progress.renderMs)} elapsed · {fmtTime(progress.audioSec)} audio
              {progress.audioSec > 0 && ` · RTF ${(progress.renderMs / 1000 / progress.audioSec).toFixed(2)}`}
            </div>
            {progress.text && <div className="small current">“{progress.text}”</div>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="card">
          <h2>Result</h2>
          <table className="stats">
            <tbody>
              <tr><th>Backend</th><td>{result.device} ({result.dtype}){result.fallbackReason && <div className="small muted">{result.fallbackReason}</div>}</td></tr>
              <tr><th>Model load</th><td>{fmtMs(result.loadMs)} {result.cached ? '(from cache)' : '(includes download)'}</td></tr>
              <tr><th>Render time</th><td>{fmtMs(result.renderMs)}</td></tr>
              <tr><th>Audio duration</th><td>{fmtTime(result.audioSec)}</td></tr>
              <tr>
                <th>Real-time factor</th>
                <td>
                  <strong>{result.rtf.toFixed(2)}</strong> ({(1 / result.rtf).toFixed(1)}× real time)
                  <div className="small muted">Below 1.0 means faster than playback</div>
                </td>
              </tr>
              <tr><th>Time to first audio</th><td>{fmtMs(result.firstAudioMs)}</td></tr>
              <tr><th>Per chunk (median / p90)</th><td>{fmtMs(result.chunkMsMedian)} / {fmtMs(result.chunkMsP90)} over {result.chunks} chunks</td></tr>
              <tr><th>MP3 encode</th><td>{result.mp3EncodeMs !== undefined ? `${fmtMs(result.mp3EncodeMs)} → ${fmtBytes(result.mp3Bytes!)} at ${MP3_KBPS} kbps` : 'failed (playing WAV)'}</td></tr>
              <tr><th>WAV size</th><td>{fmtBytes(result.wavBytes)}</td></tr>
            </tbody>
          </table>
        </section>
      )}

      {audioUrl && (
        <section className="card">
          <h2>Listen</h2>
          <audio ref={audioRef} src={audioUrl} controls className="full" />
          <div className="row">
            {[1, 1.25, 1.5, 2].map((r) => (
              <button key={r} className={r === rate ? 'primary' : ''} onClick={() => setRate(r)}>{r}×</button>
            ))}
            {wavUrl && <a href={wavUrl} download={`kokoro-${voice}.wav`}>Download WAV</a>}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <div className="row spread">
            <h2>Past runs</h2>
            <div className="row">
              <button onClick={copyResults}>Copy JSON</button>
              <button onClick={() => { setHistory([]); saveHistory([]); }}>Clear</button>
            </div>
          </div>
          <div className="scroll-x">
            <table className="history">
              <thead>
                <tr><th>When</th><th>Backend</th><th>Voice</th><th>Chunks</th><th>Load</th><th>Render</th><th>Audio</th><th>RTF</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.at}>
                    <td>{new Date(h.at).toLocaleTimeString()}</td>
                    <td>{h.device}/{h.dtype}</td>
                    <td>{h.voice}</td>
                    <td>{h.chunks} ({h.chunking === 'sentence' ? '1/req' : '≤3/req'})</td>
                    <td>{fmtMs(h.loadMs)}</td>
                    <td>{fmtMs(h.renderMs)}</td>
                    <td>{fmtTime(h.audioSec)}</td>
                    <td><strong>{h.rtf.toFixed(2)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
