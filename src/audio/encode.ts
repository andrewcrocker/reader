import type { Mp3In, Mp3Out } from './mp3.worker';

export const MP3_KBPS = 48;

/** Encodes PCM parts to MP3 off the main thread. Parts are transferred (detached) to the worker. */
export async function encodeMp3(parts: Int16Array[], sampleRate: number): Promise<Blob> {
  const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Mp3Out>) => {
        if (e.data.type === 'done') resolve(e.data.blob);
        else reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'mp3 worker failed'));
      const post = (m: Mp3In, t: Transferable[] = []) => worker.postMessage(m, t);
      post({ type: 'start', sampleRate, kbps: MP3_KBPS });
      for (const p of parts) {
        const buf = p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) as ArrayBuffer;
        post({ type: 'append', pcm: buf }, [buf]);
      }
      post({ type: 'finish' });
    });
  } finally {
    worker.terminate();
  }
}
