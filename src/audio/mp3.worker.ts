/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs';

// Streams Int16 PCM in, emits a single MP3 blob. Encoding one continuous stream
// (rather than per-chunk MP3s) avoids encoder padding gaps between sentences.

export type Mp3In =
  | { type: 'start'; sampleRate: number; kbps: number }
  | { type: 'append'; pcm: ArrayBuffer }
  | { type: 'finish' };
export type Mp3Out = { type: 'done'; blob: Blob } | { type: 'error'; message: string };

let enc: Mp3Encoder | null = null;
let parts: BlobPart[] = [];
const FRAME = 1152 * 8;

self.onmessage = (e: MessageEvent<Mp3In>) => {
  try {
    const msg = e.data;
    if (msg.type === 'start') {
      enc = new Mp3Encoder(1, msg.sampleRate, msg.kbps);
      parts = [];
    } else if (msg.type === 'append') {
      if (!enc) throw new Error('encoder not started');
      const pcm = new Int16Array(msg.pcm);
      for (let o = 0; o < pcm.length; o += FRAME) {
        const out = enc.encodeBuffer(pcm.subarray(o, o + FRAME));
        if (out.length) parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice());
      }
    } else if (msg.type === 'finish') {
      if (!enc) throw new Error('encoder not started');
      const tail = enc.flush();
      if (tail.length) parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.length).slice());
      const blob = new Blob(parts, { type: 'audio/mpeg' });
      enc = null;
      parts = [];
      (self as DedicatedWorkerGlobalScope).postMessage({ type: 'done', blob } satisfies Mp3Out);
    }
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'error', message: String(err) } satisfies Mp3Out);
  }
};
