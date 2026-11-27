import { describe, expect, it } from 'vitest';
import { CHIME_RATE, chimeSamples } from './chime';

const peak = (f: Float32Array) => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Dominant pitch of a slice, by counting upward zero crossings. */
function pitch(f: Float32Array, fromSec: number, toSec: number): number {
  let n = 0;
  for (let i = Math.round(fromSec * CHIME_RATE) + 1; i < Math.round(toSec * CHIME_RATE); i++) if (f[i - 1] <= 0 && f[i] > 0) n++;
  return n / (toSec - fromSec);
}

describe('chimeSamples', () => {
  it('is short and quiet', () => {
    for (const kind of ['start', 'end'] as const) {
      const f = chimeSamples(kind);
      expect(f.length / CHIME_RATE).toBeLessThan(1);
      expect(peak(f)).toBeGreaterThan(0.1);
      expect(peak(f)).toBeLessThan(0.4);
    }
  });

  it('starts and ends at silence so it never clicks', () => {
    for (const kind of ['start', 'end'] as const) {
      const f = chimeSamples(kind);
      expect(Math.abs(f[0])).toBeLessThan(0.01);
      expect(Math.abs(f[f.length - 1])).toBeLessThan(0.01);
    }
  });

  it('rises for start and falls for end', () => {
    const start = chimeSamples('start');
    const end = chimeSamples('end');
    expect(pitch(start, 0.3, 0.4)).toBeGreaterThan(pitch(start, 0.02, 0.12));
    expect(pitch(end, 0.45, 0.6)).toBeLessThan(pitch(end, 0.02, 0.18));
  });

  it('makes the end chime the longer one', () => {
    expect(chimeSamples('end').length).toBeGreaterThan(chimeSamples('start').length);
  });
});
