import { describe, expect, it } from 'vitest';
import type { Article } from '../db';
import { displayState, fmtDuration, fmtSpeed, queueSummary, rowMeta, urlTitle, type Ctx } from './display';

const base: Article = {
  id: 'a',
  source: 'url',
  url: 'https://www.example.com/2026/story/',
  title: 'A story',
  siteName: 'Example',
  savedAt: 0,
  status: 'ready',
  sentences: Array.from({ length: 10 }, (_, i) => ({ i, text: 'one two three four five six seven eight nine ten' })),
  durationSec: 840,
  positionSec: 0,
  queueOrder: 1,
};
const ctx: Ctx = { online: true, voiceReady: true, speed: 1 };
const art = (p: Partial<Article>): Article => ({ ...base, ...p });

describe('displayState (SPEC §9a)', () => {
  it('maps each condition, first match wins', () => {
    expect(displayState(art({ deletedAt: 1, archivedAt: 1 }), ctx)).toBe('deleted');
    expect(displayState(art({ archivedAt: 1 }), ctx)).toBe('played');
    expect(displayState(art({ status: 'waiting' }), ctx)).toBe('waiting');
    expect(displayState(art({ status: 'fetching' }), { ...ctx, online: false })).toBe('waiting');
    expect(displayState(art({ status: 'fetching' }), ctx)).toBe('fetching');
    expect(displayState(art({ status: 'failed' }), ctx)).toBe('failed');
    expect(displayState(art({ status: 'extracted' }), ctx)).toBe('queued');
    expect(displayState(art({ status: 'rendering' }), ctx)).toBe('rendering');
    expect(displayState(art({}), { ...ctx, currentId: 'a' })).toBe('playing');
    expect(displayState(art({ positionSec: 10 }), ctx)).toBe('playing');
    expect(displayState(art({}), ctx)).toBe('ready');
  });
});

describe('rowMeta', () => {
  const text = (a: Article, c: Ctx = ctx) => rowMeta(a, displayState(a, c), c).segs.map((s) => s.text).join(' · ');

  it('reads like the design', () => {
    expect(text(art({}))).toBe('14 m · Offline · Example');
    expect(text(art({ positionSec: 0 }), { ...ctx, currentId: 'a' })).toBe('Playing · 14 m left · Example');
    expect(text(art({ status: 'rendering', renderProgress: 0.42, durationSec: undefined }))).toMatch(/^Preparing 42% · ~\d+ m · Example$/);
    expect(text(art({ status: 'extracted', durationSec: undefined }))).toMatch(/^Queued for audio · ~\d+ m · Example$/);
    expect(text(art({ status: 'extracted' }), { ...ctx, voiceReady: false })).toMatch(/^Waiting for voice download/);
    expect(text(art({ status: 'fetching', sentences: [] }))).toBe('Fetching page…');
    expect(text(art({ status: 'failed' }))).toBe('Couldn’t load the page');
    expect(text(art({ archivedAt: 1 }))).toBe('Played · Example');
    expect(text(art({ extractionQuality: 'partial', durationSec: 360 }))).toBe('Partial · 6 m found · Example');
  });

  it('remaining time accounts for speed', () => {
    expect(text(art({ positionSec: 0 }), { ...ctx, currentId: 'a', speed: 2 })).toBe('Playing · 7 m left · Example');
  });

  it('speaks the state last', () => {
    expect(rowMeta(art({}), 'ready', ctx).spoken).toBe('A story, Example, 14 minutes, ready');
  });
});

describe('formatting', () => {
  it('durations', () => {
    expect(fmtDuration(20)).toBe('1 m');
    expect(fmtDuration(840)).toBe('14 m');
    expect(fmtDuration(9960)).toBe('2 h 46 m');
  });
  it('speed', () => {
    expect(fmtSpeed(1)).toBe('1.0×');
    expect(fmtSpeed(1.4)).toBe('1.4×');
    expect(fmtSpeed(1.25)).toBe('1.25×');
  });
  it('url titles', () => {
    expect(urlTitle('https://www.tidewaterquarterly.com/2026/salt-marsh-comeback/')).toBe('tidewaterquarterly.com/2026/salt-marsh-comeback');
  });
  it('queue summary', () => {
    expect(queueSummary([art({}), art({ id: 'b' })], { ...ctx, speed: 1.4 })).toBe('2 articles · 20 m at 1.4×');
    expect(queueSummary([art({}), art({ id: 'c', status: 'fetching', sentences: [] })], ctx)).toBe('1 article · 14 m at 1.0× + 1 fetching');
    expect(queueSummary([], ctx)).toBe('Your queue is empty');
  });
});
