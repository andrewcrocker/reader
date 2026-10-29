import type { Device, Dtype, KokoroIn, KokoroOut } from './kokoro.worker';
import type { EnginePref, VoiceQuality } from '../db';

export type { Device, Dtype };

export interface LoadInfo {
  device: Device;
  dtype: Dtype;
  loadMs: number;
  cached: boolean;
  fallbackReason?: string;
  crossOriginIsolated: boolean;
}

export interface SynthResult {
  pcm: Float32Array;
  sampleRate: number;
  ms: number;
}

export interface LoadCallbacks {
  onStatus?: (message: string) => void;
  onProgress?: (file: string, loaded: number, total: number) => void;
}

/** The worker crashed, hung or lost its GPU. Not the text's fault: rebuild the engine and try again. */
export class EngineLostError extends Error {}

/** Longest one chunk (≤300 characters, ~20 s of speech) may take before we assume the worker hung. */
const CHUNK_TIMEOUT_MS = 90_000;

/** On-device Kokoro, running in a dedicated worker. */
export class KokoroEngine {
  readonly id = 'kokoro';
  /** Kokoro truncates at 510 phoneme tokens; keep text chunks comfortably below that. */
  readonly maxCharsPerRequest = 300;

  private worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: SynthResult) => void; reject: (e: Error) => void }>();
  private loadWaiter: { resolve: (i: LoadInfo) => void; reject: (e: Error) => void; cb: LoadCallbacks } | null = null;
  info: LoadInfo | null = null;
  /** Set once the worker is unusable; getSharedEngine then makes a new one. */
  broken = false;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<KokoroOut>) => this.handle(e.data);
    this.worker.onerror = (e) => this.lose(e.message || 'TTS worker crashed');
  }

  load(pref: EnginePref, opts: { gpuDtype?: Dtype; wasmDtype?: Dtype } = {}, cb: LoadCallbacks = {}): Promise<LoadInfo> {
    return new Promise((resolve, reject) => {
      this.loadWaiter = { resolve, reject, cb };
      this.post({ type: 'load', device: pref, dtype: opts.gpuDtype, wasmDtype: opts.wasmDtype });
    });
  }

  synthesize(text: string, voice: string): Promise<SynthResult> {
    const id = this.nextId++;
    if (this.broken) return Promise.reject(new EngineLostError('engine lost'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.lose('Voice engine stopped responding'), CHUNK_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.post({ type: 'generate', id, text, voice });
    });
  }

  dispose() {
    this.broken = true;
    this.worker.terminate();
    this.failAll(new EngineLostError('engine disposed'));
  }

  private lose(message: string) {
    if (this.broken) return;
    console.warn('Voice engine lost:', message);
    this.broken = true;
    this.worker.terminate();
    this.failAll(new EngineLostError(message));
  }

  private post(m: KokoroIn) {
    this.worker.postMessage(m);
  }

  private handle(m: KokoroOut) {
    switch (m.type) {
      case 'progress':
        this.loadWaiter?.cb.onProgress?.(m.file, m.loaded, m.total);
        break;
      case 'status':
        this.loadWaiter?.cb.onStatus?.(m.message);
        break;
      case 'loaded': {
        const { type: _t, ...info } = m;
        this.info = info;
        this.loadWaiter?.resolve(info);
        this.loadWaiter = null;
        break;
      }
      case 'audio':
        this.pending.get(m.id)?.resolve({ pcm: m.pcm, sampleRate: m.sampleRate, ms: m.ms });
        this.pending.delete(m.id);
        break;
      case 'error':
        if (m.id !== undefined) {
          this.pending.get(m.id)?.reject(new Error(m.message));
          this.pending.delete(m.id);
        } else {
          this.loadWaiter?.reject(new Error(m.message));
          this.loadWaiter = null;
        }
        break;
      case 'lost':
        this.lose(m.message);
        break;
    }
  }

  private failAll(err: Error) {
    this.loadWaiter?.reject(err);
    this.loadWaiter = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

let shared: { engine: KokoroEngine; pref: EnginePref; quality: VoiceQuality; ready: Promise<LoadInfo>; loadedAt?: number } | null = null;

/** How long to stay on the slow WASM fallback before trying the GPU again. */
const GPU_RETRY_MS = 60_000;

/**
 * Fell back to WASM on a phone that has WebGPU. Usually the GPU was briefly unavailable (Android
 * takes it away while the app is in the background), so try it again once the app is in front.
 * WASM is several times slower on phones, so this is worth the ~10 s reload.
 */
function shouldRetryGpu(s: NonNullable<typeof shared>): boolean {
  return (
    s.pref === 'auto' &&
    s.quality === 'high' &&
    s.engine.info?.device === 'wasm' &&
    'gpu' in navigator &&
    document.visibilityState === 'visible' &&
    Date.now() - (s.loadedAt ?? Infinity) > GPU_RETRY_MS
  );
}

/**
 * Voice quality (DESIGN "Settings") is the model's quantization:
 * - high: fp32 on WebGPU (~310 MB); phones without WebGPU fall back to q8 on WASM, the path the spike measured.
 * - standard: q8 (~90 MB) on WASM. kokoro-js's quantized builds aren't reliable on WebGPU, so this skips it.
 */
function loadPlan(pref: EnginePref, quality: VoiceQuality): { pref: EnginePref; gpuDtype: Dtype; wasmDtype: Dtype } {
  if (quality === 'standard') return { pref: 'wasm', gpuDtype: 'q8', wasmDtype: 'q8' };
  return { pref, gpuDtype: 'fp32', wasmDtype: 'q8' };
}

/** Frees the model (~100–330 MB) when nothing needs it; the next request loads it again. */
export function disposeSharedEngine(): void {
  shared?.engine.dispose();
  shared = null;
}

/** The current shared engine if it can still be used for these settings, without creating one. */
export function reusableEngine(pref: EnginePref, quality: VoiceQuality): KokoroEngine | null {
  if (shared && !shared.engine.broken && shared.pref === pref && shared.quality === quality && !shouldRetryGpu(shared)) return shared.engine;
  return null;
}

/** The pipeline's long-lived engine. Re-created if the backend preference or quality changes. */
export function getSharedEngine(pref: EnginePref, quality: VoiceQuality, cb?: LoadCallbacks): { engine: KokoroEngine; ready: Promise<LoadInfo> } {
  if (shared && reusableEngine(pref, quality) === shared.engine) return shared;
  shared?.engine.dispose();
  const engine = new KokoroEngine();
  const plan = loadPlan(pref, quality);
  const ready = engine.load(plan.pref, { gpuDtype: plan.gpuDtype, wasmDtype: plan.wasmDtype }, cb);
  ready.then(
    () => {
      if (shared?.engine === engine) shared.loadedAt = Date.now();
    },
    () => {
      if (shared?.engine === engine) shared = null;
    },
  );
  shared = { engine, pref, quality, ready };
  return shared;
}
