import type { Article, Settings } from '../db';

// SPEC §9a: queue-row display state from article fields. First match wins.

export type DisplayState =
  | 'deleted'
  | 'played'
  | 'waiting'
  | 'fetching'
  | 'failed'
  | 'queued'
  | 'rendering'
  | 'playing'
  | 'ready';

export interface Ctx {
  online: boolean;
  currentId?: string;
  voiceReady: boolean;
  speed: number;
}

export function displayState(a: Article, ctx: Ctx): DisplayState {
  if (a.deletedAt) return 'deleted';
  if (a.archivedAt) return 'played';
  if (a.status === 'waiting' || (a.status === 'fetching' && !ctx.online)) return 'waiting';
  if (a.status === 'fetching') return 'fetching';
  if (a.status === 'failed') return 'failed';
  if (a.status === 'extracted') return 'queued';
  if (a.status === 'rendering') return 'rendering';
  if (a.id === ctx.currentId || a.positionSec > 0) return 'playing';
  return 'ready';
}

export const isPartial = (a: Article) => a.extractionQuality === 'partial';

/** Words per second at 1.0× for estimates before audio exists (~150 wpm). */
const WPS = 2.5;

/** Audio length at 1.0×: the real duration once rendered, else an estimate from the text. */
export function lengthSec(a: Article): number | undefined {
  if (a.durationSec) return a.durationSec;
  if (!a.sentences.length) return undefined;
  const words = a.sentences.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  return words / WPS;
}

export function remainingSec(a: Article, speed: number): number | undefined {
  const len = lengthSec(a);
  if (len === undefined) return undefined;
  return Math.max(0, len - (a.durationSec ? a.positionSec : 0)) / speed;
}

/** "14 m", "2 h 46 m". Rounds up so nothing reads "0 m". */
export function fmtDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} m`;
  return `${Math.floor(min / 60)} h ${min % 60} m`;
}

export function fmtSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`.replace(/^(\d)×$/, '$1.0×');
}

/** URL shown as a title before a real one arrives: domain + path, no scheme. */
export function urlTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/\/$/, '');
    return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return url;
  }
}

export function hasRealTitle(a: Article): boolean {
  return !!a.title && a.title !== a.url;
}

export function siteLabel(a: Article): string | undefined {
  return a.siteName || a.domain || (a.source === 'text' ? 'Pasted text' : undefined);
}

/** One meta-line segment; `strong` segments get the state's emphasis color. */
export interface Seg {
  text: string;
  strong?: boolean;
}

export type Tone = 'muted' | 'fg' | 'accent' | 'warn' | 'error';

export interface RowMeta {
  glyph: 'fetching' | 'rendering' | 'queued' | 'ready' | 'playing' | 'partial' | 'failed' | 'waiting' | 'played';
  tone: Tone;
  segs: Seg[];
  /** 0..1 listening progress for the 3 dp bar, when in progress. */
  progress?: number;
  /** For TalkBack: "Title, site, 14 minutes, ready". */
  spoken: string;
}

export function rowMeta(a: Article, state: DisplayState, ctx: Ctx & { isNew?: boolean }): RowMeta {
  const site = siteLabel(a);
  const rem = remainingSec(a, ctx.speed);
  const len = lengthSec(a);
  const dur = (s: number | undefined, approx = false) => (s === undefined ? undefined : `${approx ? '~' : ''}${fmtDuration(s)}`);
  const segs: Seg[] = [];
  const push = (text: string | undefined, strong = false) => text && segs.push({ text, strong });
  if (ctx.isNew) push('New', true);
  let glyph: RowMeta['glyph'] = 'ready';
  let tone: Tone = 'muted';
  let spokenState = '';
  let progress: number | undefined;

  if (isPartial(a) && (state === 'ready' || state === 'rendering' || state === 'playing' || state === 'queued')) {
    glyph = 'partial';
    tone = 'warn';
    push('Partial', true);
    push(len !== undefined ? `${fmtDuration(len / ctx.speed)} found` : undefined);
    push(site);
    spokenState = 'partial';
    if (state === 'playing' && a.durationSec) progress = a.positionSec / a.durationSec;
  } else {
    switch (state) {
      case 'fetching':
        glyph = 'fetching';
        push('Fetching page…');
        spokenState = 'fetching';
        break;
      case 'waiting':
        glyph = 'waiting';
        push(a.status === 'waiting' && !ctx.online ? 'Saved · will fetch when online' : 'Will fetch when online');
        spokenState = 'waiting for connection';
        break;
      case 'failed':
        glyph = 'failed';
        tone = 'error';
        push(a.source === 'text' ? 'Couldn’t prepare this text' : 'Couldn’t load the page', true);
        spokenState = 'failed';
        break;
      case 'queued':
        glyph = 'queued';
        push(ctx.voiceReady ? 'Queued for audio' : 'Waiting for voice download');
        push(dur(len !== undefined ? len / ctx.speed : undefined, true));
        push(site);
        spokenState = 'queued for audio';
        break;
      case 'rendering':
        glyph = 'rendering';
        tone = 'fg';
        push(`Preparing ${Math.round((a.renderProgress ?? 0) * 100)}%`, true);
        push(dur(len !== undefined ? len / ctx.speed : undefined, true));
        push(site);
        spokenState = 'preparing audio';
        break;
      case 'playing':
        glyph = 'playing';
        tone = 'accent';
        if (a.id === ctx.currentId) push('Playing', true);
        push(rem !== undefined ? `${fmtDuration(rem)} left` : undefined);
        push(site);
        progress = a.durationSec ? Math.min(1, a.positionSec / a.durationSec) : undefined;
        spokenState = a.id === ctx.currentId ? 'playing' : 'in progress';
        break;
      case 'played':
        glyph = 'played';
        push('Played');
        push(site);
        spokenState = 'played';
        break;
      default:
        glyph = 'ready';
        push(dur(len !== undefined ? len / ctx.speed : undefined));
        push('Offline');
        push(site);
        spokenState = 'ready';
    }
  }

  const title = hasRealTitle(a) ? a.title : urlTitle(a.url);
  const mins = rem !== undefined ? Math.max(1, Math.round(rem / 60)) : 0;
  const minutes = rem !== undefined && state !== 'played' ? `${mins} minute${mins === 1 ? '' : 's'}` : undefined;

  const spoken = [title, site, minutes, spokenState].filter(Boolean).join(', ');
  return { glyph, tone, segs, progress, spoken };
}

/** Header line: "8 articles · 2 h 46 m at 1.4×" (+ " + 1 fetching"). */
export function queueSummary(upNext: Article[], ctx: Ctx): string {
  if (!upNext.length) return 'Your queue is empty';
  const fetching = upNext.filter((a) => a.status === 'fetching' || a.status === 'waiting').length;

  const counted = upNext.filter((a) => a.sentences.length);
  const total = counted.reduce((n, a) => n + (remainingSec(a, ctx.speed) ?? 0), 0);
  const parts = [`${counted.length} article${counted.length === 1 ? '' : 's'}`];
  if (total > 0) parts.push(`${fmtDuration(total)} at ${fmtSpeed(ctx.speed)}`);
  let line = parts.join(' · ');
  if (fetching) line += counted.length ? ` + ${fetching} fetching` : '';
  if (!counted.length) line = `${fetching} fetching`;
  return line;
}

export function voiceReady(s: Settings): boolean {
  return s.voiceModel.status === 'ready';
}
