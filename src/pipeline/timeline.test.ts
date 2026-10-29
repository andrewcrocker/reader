import { describe, expect, it } from 'vitest';
import type { Sentence } from '../db';
import { placeChunk } from './timeline';

describe('placeChunk', () => {
  it('splits a chunk across its sentences by character share', () => {
    const s: Sentence[] = [{ i: 0, text: 'aaaa' }, { i: 1, text: 'bb' }, { i: 2, text: 'cc' }];

    placeChunk(s, { i: 0, text: '', sentenceStart: 1, sentenceCount: 2, pauseAfter: 0 }, 10, 4);
    expect(s[0].start).toBeUndefined();
    expect(s[1]).toMatchObject({ start: 10, end: 12 });
    expect(s[2]).toMatchObject({ start: 12, end: 14 });
  });
});
