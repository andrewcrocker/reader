import type { Device, Dtype, KokoroIn, KokoroOut } from './kokoro.worker';
import type { EnginePref } from '../db';

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

  constructor() {
    this.worker.onmessage = (e: MessageEvent<KokoroOut>) => this.handle(e.data);
    this.worker.onerror = (e) => this.failAll(new Error(e.message || 'TTS worker crashed'));
  }

  load(pref: EnginePref, opts: { gpuDtype?: Dtype; wasmDtype?: Dtype } = {}, cb: LoadCallbacks = {}): Promise<LoadInfo> {
    return new Promise((resolve, reject) => {
      this.loadWaiter = { resolve, reject, cb };
      this.post({ type: 'load', device: pref, dtype: opts.gpuDtype, wasmDtype: opts.wasmDtype });
    });
  }

  synthesize(text: string, voice: string): Promise<SynthResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'generate', id, text, voice });
    });
  }

  dispose() {
    this.worker.terminate();
    this.failAll(new Error('engine disposed'));
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
    }
  }

  private failAll(err: Error) {
    this.loadWaiter?.reject(err);
    this.loadWaiter = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

let shared: { engine: KokoroEngine; pref: EnginePref; ready: Promise<LoadInfo> } | null = null;

/** The pipeline's long-lived engine. Re-created if the engine preference changes. */
export function getSharedEngine(pref: EnginePref, cb?: LoadCallbacks): { engine: KokoroEngine; ready: Promise<LoadInfo> } {
  if (shared && shared.pref === pref) return shared;
  shared?.engine.dispose();
  const engine = new KokoroEngine();
  const ready = engine.load(pref, {}, cb);
  ready.catch(() => {
    if (shared?.engine === engine) shared = null;
  });
  shared = { engine, pref, ready };
  return shared;
}
