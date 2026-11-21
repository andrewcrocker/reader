import { floatToInt16, wavBlob } from '../audio/pcm';

// Short two-note chimes that mark where an article starts and ends (SPEC §7).
// Made in code, so there's no file to fetch and they work offline.

export type ChimeKind = 'start' | 'end';

export const CHIME_RATE = 24_000;
const PEAK = 0.22;
const E5 = 659.25;
const A5 = 880;

/** Notes as [frequency, start second, ring-out seconds]. Start rises, end falls and rings longer. */
const NOTES: Record<ChimeKind, [number, number, number][]> = {
  start: [
    [E5, 0, 0.3],
    [A5, 0.13, 0.4],
  ],
  end: [
    [A5, 0, 0.4],
    [E5, 0.2, 0.7],
  ],
};

/** The chime as mono samples in -1..1. */
export function chimeSamples(kind: ChimeKind, rate = CHIME_RATE): Float32Array {
  const notes = NOTES[kind];
  const total = Math.max(...notes.map(([, at, ring]) => at + ring));
  const out = new Float32Array(Math.ceil(total * rate));
  for (const [freq, at, ring] of notes) {
    const from = Math.round(at * rate);
    const n = Math.round(ring * rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      // 5 ms attack so it doesn't click, then a bell-like decay that reaches silence at the end.
      const env = Math.min(1, t / 0.005) * Math.exp((-5 * t) / ring) * (1 - i / n);
      const w = 2 * Math.PI * freq * t;
      out[from + i] += PEAK * env * (Math.sin(w) + 0.25 * Math.sin(2 * w));
    }
  }
  return out;
}

const MAX_WAIT_MS = 2000;
let el: HTMLAudioElement | undefined;
const urls: Partial<Record<ChimeKind, string>> = {};
let settle: (() => void) | undefined;

/** Stops a chime that is still sounding. */
export function stopChime(): void {
  el?.pause();
  settle?.();
}

/**
 * Plays a chime. Resolves when it has finished, was stopped, or couldn't play, so callers can
 * always carry on. One element plays both chimes: once a tap has started it, later chimes can
 * play without one.
 */
export function playChime(kind: ChimeKind): Promise<void> {
  stopChime();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (settle !== done) return;
      settle = undefined;
      clearTimeout(timer);
      resolve();
    };
    settle = done;
    try {
      el ??= new Audio();
      const a = el;
      a.onended = a.onerror = () => settle?.();
      a.src = urls[kind] ??= URL.createObjectURL(wavBlob([floatToInt16(chimeSamples(kind))], CHIME_RATE));
      timer = setTimeout(done, MAX_WAIT_MS);
      void a.play().catch(done);
    } catch {
      done();
    }
  });
}
