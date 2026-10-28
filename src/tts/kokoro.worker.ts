/// <reference lib="webworker" />
import { KokoroTTS, env } from 'kokoro-js';
import { env as hfEnv } from '@huggingface/transformers';
import { looksLikeSpeech } from '../audio/pcm';
import { browserCache, opfsCache, opfsWritable, type ModelCache } from './modelCache';

// Runs Kokoro off the main thread. Messages are handled one at a time.

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export type Device = 'webgpu' | 'wasm';
export type Dtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export type KokoroIn =
  | { type: 'load'; device: Device | 'auto'; dtype?: Dtype; wasmDtype?: Dtype }
  | { type: 'generate'; id: number; text: string; voice: string };

export type KokoroOut =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'status'; message: string }
  | {
      type: 'loaded';
      device: Device;
      dtype: Dtype;
      loadMs: number;
      cached: boolean;
      fallbackReason?: string;
      crossOriginIsolated: boolean;
    }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id?: number; message: string };

const post = (m: KokoroOut, t: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, t);

env.wasmPaths = `${self.location.origin}/ort/`;

const modelCache: ModelCache = opfsWritable() ? opfsCache : browserCache;
if (modelCache === opfsCache) {
  hfEnv.useBrowserCache = false;
  hfEnv.useCustomCache = true;
  hfEnv.customCache = opfsCache;
  // Free space held by any earlier Cache API copies.
  void caches.delete('transformers-cache').catch(() => {});
}

let tts: KokoroTTS | null = null;
let chain: Promise<unknown> = Promise.resolve();

const DTYPE_SUFFIX: Record<Dtype, string> = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4', q4f16: '_q4f16' };

const modelUrl = (dtype: Dtype) => `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model${DTYPE_SUFFIX[dtype]}.onnx`;

async function isCached(dtype: Dtype): Promise<boolean> {
  try {
    return !!(await modelCache.match(modelUrl(dtype)));
  } catch {
    return false;
  }
}

/**
 * transformers.js only writes the model to its cache after loading it, in a background
 * put nobody awaits. For a 90–325 MB file that write is easily cut off by closing or
 * reloading the app, leaving the model uncached (no offline rendering, re-download on
 * every launch). So stream it into the same cache key ourselves first and wait.
 */
async function ensureCached(dtype: Dtype): Promise<void> {
  const url = modelUrl(dtype);
  if (await modelCache.match(url)) return;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length') ?? 0);
  const file = url.split('/').pop()!;
  let loaded = 0;
  let lastPost = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        const now = performance.now();
        if (now - lastPost > 200) {
          lastPost = now;
          post({ type: 'progress', file, loaded, total });
        }
        controller.enqueue(chunk);
      },
    }),
  );
  // fetch() already decoded the body, so don't store headers claiming it's still encoded.
  const headers = new Headers(res.headers);
  if (headers.has('Content-Encoding')) {
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
  }
  await modelCache.put(url, new Response(counted, { headers }));
  post({ type: 'progress', file, loaded, total: total || loaded });
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadOne(device: Device, dtype: Dtype): Promise<KokoroTTS> {
  post({ type: 'status', message: `Downloading ${dtype} model…` });
  await ensureCached(dtype);
  post({ type: 'status', message: `Loading model on ${device} (${dtype})…` });
  const model = await KokoroTTS.from_pretrained(MODEL_ID, {
    device,
    dtype,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  });
  // Warm-up doubles as a sanity check: some GPU/driver combos load fine but emit NaNs or silence.
  post({ type: 'status', message: `Warming up on ${device}…` });
  const warm = await model.generate('Hello there.', { voice: 'af_heart' });
  if (!looksLikeSpeech(warm.audio)) throw new Error(`${device} produced invalid audio`);
  return model;
}

async function load(msg: Extract<KokoroIn, { type: 'load' }>) {
  const gpuDtype = msg.dtype ?? 'fp32';
  const wasmDtype = msg.wasmDtype ?? msg.dtype ?? 'q8';
  const t0 = performance.now();
  let fallbackReason: string | undefined;
  let device: Device;
  let dtype: Dtype;

  if (msg.device === 'webgpu' || (msg.device === 'auto' && (await hasWebGpu()))) {
    try {
      post({ type: 'status', message: `Loading model on WebGPU (${gpuDtype})…` });
      const cached = await isCached(gpuDtype);
      tts = await loadOne('webgpu', gpuDtype);
      device = 'webgpu';
      dtype = gpuDtype;
      return finish(device, dtype, cached);
    } catch (err) {
      if (msg.device === 'webgpu') throw err;
      fallbackReason = `WebGPU failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (msg.device === 'auto') {
    fallbackReason = 'WebGPU not available';
  }

  post({ type: 'status', message: `Loading model on WASM (${wasmDtype})…` });
  const cached = await isCached(wasmDtype);
  tts = await loadOne('wasm', wasmDtype);
  device = 'wasm';
  dtype = wasmDtype;
  return finish(device, dtype, cached);

  function finish(device: Device, dtype: Dtype, cached: boolean) {
    post({
      type: 'loaded',
      device,
      dtype,
      cached,
      fallbackReason,
      loadMs: performance.now() - t0,
      crossOriginIsolated: self.crossOriginIsolated,
    });
  }
}

async function generate(msg: Extract<KokoroIn, { type: 'generate' }>) {
  if (!tts) throw new Error('model not loaded');
  const t0 = performance.now();
  const out = await tts.generate(msg.text, { voice: msg.voice as never });
  const pcm = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio);
  post({ type: 'audio', id: msg.id, pcm, sampleRate: out.sampling_rate, ms: performance.now() - t0 }, [pcm.buffer]);
}

self.onmessage = (e: MessageEvent<KokoroIn>) => {
  const msg = e.data;
  chain = chain.then(async () => {
    try {
      if (msg.type === 'load') await load(msg);
      else await generate(msg);
    } catch (err) {
      post({ type: 'error', id: msg.type === 'generate' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
