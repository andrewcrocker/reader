import { db, type Article, type Sentence } from '../db';
import { silence } from '../audio/pcm';
import { MP3_KBPS } from '../audio/encode';
import type { Mp3In, Mp3Out } from '../audio/mp3.worker';
import { placeChunk } from '../pipeline/timeline';

// Play an article while it renders (SPEC §6.2 "progressive playback"). The renderer saves each
// chunk's PCM as it finishes; this reads them in order, encodes them with one continuous MP3
// encoder (no gaps between chunks), and appends the bytes to a MediaSource the shared <audio>
// plays. When the render finishes, the player switches to the final file at the same position.

export interface StreamTimeline {
  /** Sentences with start/end for the part that's playable so far. */
  sentences: Sentence[];
  /** Seconds of audio appended so far. */
  until: number;
  /** Chunks appended so far. */
  chunks: number;
}

export const canStream = () => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

export class RenderStream {
  private ms = new MediaSource();
  readonly url = URL.createObjectURL(this.ms);
  private sb: SourceBuffer | null = null;
  private worker: Worker | null = null;
  private waiters = new Map<number, (data: ArrayBuffer) => void>();
  private nextId = 1;
  private next = 0;
  private t = 0;
  private busy = false;
  private again = false;
  private disposed = false;
  private sentences: Sentence[];

  constructor(
    private article: Article,
    private onTimeline: (t: StreamTimeline) => void,
  ) {
    this.sentences = article.sentences.map((s) => ({ i: s.i, text: s.text }));
    this.ms.addEventListener(
      'sourceopen',
      () => {
        if (this.disposed) return;
        this.sb = this.ms.addSourceBuffer('audio/mpeg');
        // MP3 has no timestamps; play appended bytes back to back.
        this.sb.mode = 'sequence';
        void this.poke();
      },
      { once: true },
    );
  }

  /** Append any chunks rendered since last time. Call whenever render progress moves. */
  async poke(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        while (await this.step()) {
          /* keep going */
        }
      } while (this.again && !this.disposed);
    } catch (err) {
      if (!this.disposed) console.warn('render stream stopped', err);
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.waiters.clear();
    URL.revokeObjectURL(this.url);
  }

  private async step(): Promise<boolean> {
    const chunk = this.article.chunks?.[this.next];
    if (this.disposed || !this.sb || !chunk) return false;
    const row = await db.renderedChunks.get([this.article.id, chunk.i]);
    if (!row || this.disposed) return false;
    const speech = new Int16Array(row.pcm);
    const pause = silence(chunk.pauseAfter, row.sampleRate);
    const pcm = new Int16Array(speech.length + pause.length);
    pcm.set(speech);
    const bytes = await this.encode(pcm.buffer, row.sampleRate);
    if (this.disposed) return false;
    if (bytes.byteLength) await this.append(bytes);
    const dur = speech.length / row.sampleRate;
    placeChunk(this.sentences, chunk, this.t, dur);
    this.t += dur + chunk.pauseAfter;
    this.next++;
    this.onTimeline({ sentences: this.sentences.map((s) => ({ ...s })), until: this.t, chunks: this.next });
    return true;
  }

  private encode(pcm: ArrayBuffer, sampleRate: number): Promise<ArrayBuffer> {
    if (!this.worker) {
      this.worker = new Worker(new URL('../audio/mp3.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Mp3Out>) => {
        if (e.data.type !== 'bytes') return;
        this.waiters.get(e.data.id)?.(e.data.data);
        this.waiters.delete(e.data.id);
      };
      this.post({ type: 'start', sampleRate, kbps: MP3_KBPS, stream: true });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      this.post({ type: 'append', pcm, id }, [pcm]);
    });
  }

  private post(m: Mp3In, transfer: Transferable[] = []) {
    this.worker!.postMessage(m, transfer);
  }

  private append(bytes: ArrayBuffer): Promise<void> {
    const sb = this.sb!;
    return new Promise((resolve, reject) => {
      const done = () => {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('error', fail);
        reject(new Error('SourceBuffer append failed'));
      };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', fail);
      sb.appendBuffer(bytes);
    });
  }
}
