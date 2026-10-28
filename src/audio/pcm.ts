export const SAMPLE_RATE = 24_000;

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Wraps mono 16-bit PCM parts (with optional silence between) in a WAV container. */
export function wavBlob(parts: Int16Array[], sampleRate: number): Blob {
  const dataBytes = parts.reduce((n, p) => n + p.byteLength, 0);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  return new Blob([header, ...parts.map((p) => p.buffer as ArrayBuffer)], { type: 'audio/wav' });
}

export function silence(seconds: number, sampleRate: number): Int16Array {
  return new Int16Array(Math.round(seconds * sampleRate));
}

/** Rejects output that is empty, NaN, or effectively silent (seen with some WebGPU drivers). */
export function looksLikeSpeech(f: Float32Array): boolean {
  if (f.length < 2400) return false;
  let sumSq = 0;
  for (let i = 0; i < f.length; i++) {
    const s = f[i];
    if (!Number.isFinite(s)) return false;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / f.length) > 0.005;
}
