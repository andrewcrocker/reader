import { coverInk } from '../theme/color';
import { HEART_PATH } from '../ui/heart';
import { encodePng } from './png';

// The share card (spec/SHARING.md): a 1200x630 PNG drawn on a <canvas> in the app, so the Worker needs
// no image rendering. It's what shows when the link is pasted into iMessage, Slack, X or Discord, so
// the headline and the play button are big enough to read as a thumbnail and everything else is detail
// for the full size. It reads as "a playlist you can press play on": Reader's teal on the left with the
// headline, and on the right Reader's own player (the mini player's dark surface, Now Playing's cover,
// scrubber and round play button) holding the first article, the next few, and the total time.

export const CARD_W = 1200;
export const CARD_H = 630;

export interface CardItem {
  title: string;
  domain: string;
  /** `#rrggbb`: the tile color when there's no art. */
  tint: string;
  minutes?: number;
  /** Site or article art (already decoded). Without it the tile is the tint with the site's initials. */
  art?: CanvasImageSource;
}

export interface CardSpec {
  headline: string;
  /** "This week" or "All time". */
  rangeLabel: string;
  /** Every article in the list, not just the ones that fit on the card. */
  total: number;
  /** Listening time of the whole list in minutes, when the articles' lengths are known. */
  totalMinutes?: number;
  /** The first is "now playing"; the rest are the playlist under it, as many as fit. */
  items: CardItem[];
}

// DESIGN "Color": the app's own teal (`accent`, light theme) as the ground so a pasted link reads as
// Reader before anyone reads a word, and the mini player's dark surface and dark-theme accent for the player.
const C = {
  ground: '#1f5c55',
  ink: '#f3f2f0',
  inkSoft: '#cde8e2',
  surface: '#1b1a19',
  fg: '#f3f2f0',
  muted: '#bcbab5',
  track: '#373533',
  line: 'rgba(255, 255, 255, 0.09)',
  accent: '#8fd0c3',
  onAccent: '#0f2420',
  // The app icon: amber play mark on near-black.
  markBg: '#14161a',
  markFg: '#f2b84b',
};
const SERIF = '"Literata", Georgia, "Times New Roman", serif';
const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

// Layout. The headline gets the left column, the player the right.
const PAD = 72;
const PLAYER_X = 596;
const PLAYER_W = CARD_W - PLAYER_X - 64;
const PLAYER_MAX_H = CARD_H - 2 * 36;
const LEFT_W = PLAYER_X - 52 - PAD;
const IN = 30; // padding inside the player
const IN_W = PLAYER_W - IN * 2;
const NOW_TILE = 84;
const NOW_TITLE_PX = 28;
const NOW_TITLE_LH = 34;
const PLAY_D = 108;
const ROW_H = 48;
const ROW_TILE = 38;
const MAX_NEXT = 4;

/** Loads the faces the card uses, so the canvas doesn't fall back to a system font. Resolves either way. */
export async function loadCardFonts(text = ''): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = `${text} Aa`;
  await Promise.all(
    ['500 40px Literata', '600 40px Literata', '400 20px "IBM Plex Sans"', '500 20px "IBM Plex Sans"', '600 20px "IBM Plex Sans"'].map((f) => document.fonts.load(f, sample).catch(() => [])),
  );
}

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Greedy word wrap. A hyphenated word may break after its hyphen (unless `hyphens` is false), a word wider
 * than the line is split by characters, and if the text doesn't fit in `maxLines` the last line is cut at a
 * word and ends in an ellipsis.
 */
export function wrapText(measure: (s: string) => number, text: string, maxW: number, maxLines: number, hyphens = true): string[] {
  // Pieces to place: each word, and each part of a hyphenated word, which sticks to the part before it.
  const pieces: { t: string; glue: boolean }[] = [];
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)) {
    (hyphens ? (word.match(/[^-]+-*|-+/g) ?? [word]) : [word]).forEach((part, k) => pieces.push({ t: part, glue: k > 0 }));
  }
  const lines: string[] = [];
  let line = '';
  for (const { t, glue } of pieces) {
    let piece = t;
    const joined = line ? (glue ? line + piece : `${line} ${piece}`) : piece;
    if (measure(joined) <= maxW) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // A single word wider than the line (a long URL): split it by characters.
    while (measure(piece) > maxW && piece.length > 1) {
      let cut = piece.length - 1;
      while (cut > 1 && measure(piece.slice(0, cut)) > maxW) cut--;
      lines.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    line = piece;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const words = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`.split(' ');
  while (words.length > 1 && measure(`${words.join(' ')}…`) > maxW) words.pop();
  let last = words.join(' ');
  while (last.length > 1 && measure(`${last}…`) > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.replace(/[\s,;:.\-–—]+$/, '')}…`;
  return kept;
}

/** Draws text with extra space between letters (for the small caps label). */
function tracked(ctx: Ctx, text: string, x: number, y: number, spacing: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx - spacing;
}

/** The app icon's mark, at (x, y) with side `s`. */
function drawMark(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save();
  roundRect(ctx, x, y, s, s, s * 0.22);
  ctx.fillStyle = C.markBg;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.344, y + s * 0.286);
  ctx.lineTo(x + s * 0.344, y + s * 0.719);
  ctx.lineTo(x + s * 0.734, y + s * 0.505);
  ctx.closePath();
  ctx.fillStyle = C.markFg;
  ctx.fill();
  ctx.restore();
}

function initialsOf(domain: string): string {
  const words = domain.replace(/^(www|en|m)\./, '').replace(/\.(com|org|net|io|co|dev|blog|news|me|limo)$/i, '').split(/[\s.\-_]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const mark = words.length >= 2 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? '·');
  return mark.toUpperCase();
}

function drawTile(ctx: Ctx, it: CardItem, x: number, y: number, size: number) {
  ctx.save();
  roundRect(ctx, x, y, size, size, Math.round(size * 0.22));
  ctx.clip();
  if (it.art) {
    const src = it.art as { width?: number; height?: number };
    const sw = src.width ?? size;
    const sh = src.height ?? size;
    const side = Math.min(sw, sh);
    ctx.fillStyle = '#2f2d2b';
    ctx.fillRect(x, y, size, size);
    ctx.drawImage(it.art, (sw - side) / 2, (sh - side) / 2, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = it.tint;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = coverInk(it.tint);
    ctx.font = `600 ${Math.round(size * 0.39)}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsOf(it.domain), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
  // The same hairline the app puts around its art, so a pale tile still has an edge on the dark surface.
  ctx.save();
  roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, Math.round(size * 0.22));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** "0:00", "25:00", "1:05:00": a clock for a length in minutes. */
export function fmtClock(minutes: number): string {
  const sec = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "45 m", "2 h 17 m", "21 h": the app's own duration style (queue rows, mini player), without a trailing "0 m". */
export function fmtTotal(minutes: number): string {
  const min = Math.max(1, Math.round(minutes));
  if (min < 60) return `${min} m`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min / 60} h`;
}

/** The player's footer: "+2 more · 2 h 17 m total". Either half is left out when there's nothing to say. */
export function footerText(more: number, totalMinutes?: number): { more: string; total: string } {
  return { more: more > 0 ? `+${more} more` : '', total: totalMinutes ? `${fmtTotal(totalMinutes)} total` : '' };
}

/** The width of the widest piece of `text` that can't be broken: a word, or a hyphenated word's longest part. */
export function widestWord(measure: (s: string) => number, text: string): number {
  let widest = 0;
  for (const word of text.split(/\s+/)) {
    for (const part of word.match(/[^-]+-*|-+/g) ?? []) widest = Math.max(widest, measure(part));
  }
  return widest;
}

/** What goes on the card besides the headline: the "now playing" item, the rows under it, and what's left over. */
export function playlistSplit(spec: CardSpec, maxNext: number): { now: CardItem | undefined; next: CardItem[]; more: number } {
  const [now, ...rest] = spec.items;
  const next = rest.slice(0, Math.max(0, maxNext));
  return { now, next, more: Math.max(0, spec.total - (now ? 1 : 0) - next.length) };
}

/** Draws a glyph from the icon set (a 24x24 path) at `size`, centered on (cx, cy). */
function glyph(ctx: Ctx, d: string, cx: number, cy: number, size: number, o: { fill?: string; stroke?: string; width?: number } = {}) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  const path = new Path2D(d);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill(path);
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width ?? 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.restore();
}

// Paths from src/ui/Icon.tsx, so the transport looks like the app's.
const PLAY_PATH = 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z';
const SKIP_BACK = ['M4.6 9.2A8 8 0 1 1 4 13', 'M4 4.5V9.5h5'];
const SKIP_FWD = ['M19.4 9.2A8 8 0 1 0 20 13', 'M20 4.5V9.5h-5'];

/** One-line text cut to `maxW` with an ellipsis. */
function oneLine(ctx: Ctx, text: string, maxW: number): string {
  return wrapText((t) => ctx.measureText(t).width, text, maxW, 1)[0] ?? '';
}

function skipIcon(ctx: Ctx, paths: string[], cx: number, cy: number, size: number, seconds: number) {
  for (const d of paths) glyph(ctx, d, cx, cy, size, { stroke: C.fg, width: 1.5 });
  ctx.save();
  ctx.fillStyle = C.fg;
  ctx.font = `600 ${Math.round(size * 0.29)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(seconds), cx + (size / 24) * (paths === SKIP_BACK ? 0.6 : -0.6), cy + (size / 24) * 3.4);
  ctx.restore();
}

interface PlayerLayout {
  next: CardItem[];
  more: number;
  nowTitle: string[];
  height: number;
}

/** How tall the player is, and how many "up next" rows fit: as many as the card has room for, up to `MAX_NEXT`. */
function layoutPlayer(ctx: Ctx, spec: CardSpec): PlayerLayout {
  ctx.font = `500 ${NOW_TITLE_PX}px ${SERIF}`;
  const measure = (t: string) => ctx.measureText(t).width;
  const { now } = playlistSplit(spec, 0);
  const nowTitle = now ? wrapText(measure, now.title, IN_W - NOW_TILE - 20, 2) : [];
  const nowH = Math.max(NOW_TILE, nowTitle.length * NOW_TITLE_LH + 6 + 24);
  const top = IN - 2 + nowH + 18 + 44 + 14 + PLAY_D + 8 + 34; // through the "Listen on Reader" caption
  const bottom = 20; // footer line and the padding under it
  for (let n = Math.min(MAX_NEXT, Math.max(0, spec.items.length - 1)); n >= 0; n--) {
    const rows = n ? 20 + n * ROW_H : 0;
    const foot = playlistSplit(spec, n).more > 0 || (spec.total > 1 && spec.totalMinutes) ? 34 : 0;
    const height = top + rows + foot + bottom;
    if (height <= PLAYER_MAX_H || n === 0) {
      const { next, more } = playlistSplit(spec, n);
      return { next, more, nowTitle, height };
    }
  }
  return { next: [], more: 0, nowTitle, height: top + bottom };
}

/** Draws the card into a 1200x630 context. Fonts must already be loaded (`loadCardFonts`). */
export function drawCard(ctx: Ctx, spec: CardSpec): void {
  ctx.save();
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineCap = 'butt';

  // Ground: Reader's teal, lit from the top right (behind the player) and shaded toward the bottom left.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const lit = ctx.createRadialGradient(PLAYER_X + PLAYER_W / 2, 150, 0, PLAYER_X + PLAYER_W / 2, 150, 720);
  lit.addColorStop(0, 'rgba(143, 208, 195, 0.30)');
  lit.addColorStop(1, 'rgba(143, 208, 195, 0)');
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const shade = ctx.createLinearGradient(0, 0, 0, CARD_H);
  shade.addColorStop(0.35, 'rgba(8, 28, 25, 0)');
  shade.addColorStop(1, 'rgba(8, 28, 25, 0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Brand.
  drawMark(ctx, PAD, 58, 48);
  ctx.fillStyle = C.inkSoft;
  ctx.font = `600 29px ${SANS}`;
  ctx.fillText('Reader', PAD + 62, 92);

  drawHeadline(ctx, spec);
  drawPlayer(ctx, spec);
  ctx.restore();
}

/** The eyebrow and headline: the largest size where no word is broken, nothing is cut, and it clears the brand and the foot of the card. */
function drawHeadline(ctx: Ctx, spec: CardSpec) {
  const eyebrow = `${spec.rangeLabel} · ${spec.total} ${spec.total === 1 ? 'article' : 'articles'}`.toUpperCase();
  const floor = 52;
  let size = 92;
  let lines: string[] = [];
  let lh = 0;
  let top = 0;
  for (; size >= floor; size -= 4) {
    ctx.font = `500 ${size}px ${SERIF}`;
    const measure = (t: string) => ctx.measureText(t).width;
    const maxLines = size >= 76 ? 3 : 4;
    // "all-time" stays together if the line is wide enough for it; otherwise it may break after the hyphen.
    const whole = spec.headline.split(/\s+/).every((w) => measure(w) <= LEFT_W);
    lines = wrapText(measure, spec.headline, LEFT_W, maxLines, !whole);
    lh = Math.round(size * 1.06);
    // The eyebrow and headline sit centered between the brand and the foot of the card.
    top = Math.max(150, Math.round((CARD_H + 84 - (56 + lines.length * lh)) / 2) - 18);
    const fits = widestWord(measure, spec.headline) <= LEFT_W && !lines.at(-1)?.endsWith('…') && top + 56 + lines.length * lh <= CARD_H - 72;
    if (fits || size <= floor) break;
  }

  // Eyebrow: the heart (loved), then "THIS WEEK · 6 ARTICLES".
  glyph(ctx, HEART_PATH, PAD + 17, top + 10, 36, { fill: C.inkSoft });
  ctx.fillStyle = C.inkSoft;
  let eyebrowPx = 24;
  ctx.font = `600 ${eyebrowPx}px ${SANS}`;
  const trackedW = (t: string, sp: number) => [...t].reduce((w, ch) => w + ctx.measureText(ch).width + sp, -sp);
  while (eyebrowPx > 18 && PAD + 42 + trackedW(eyebrow, 2.6) > PAD + LEFT_W) ctx.font = `600 ${--eyebrowPx}px ${SANS}`;
  tracked(ctx, eyebrow, PAD + 42, top + 20, 2.6);

  ctx.fillStyle = C.ink;
  ctx.font = `500 ${size}px ${SERIF}`;
  const headTop = top + 30 + 26;
  lines.forEach((l, i) => ctx.fillText(l, PAD, headTop + size * 0.84 + i * lh));
}

/** The player: now playing, a scrubber, the round play button with "Listen on Reader", the next few items and the total time. */
function drawPlayer(ctx: Ctx, spec: CardSpec) {
  const lay = layoutPlayer(ctx, spec);
  const { now } = playlistSplit(spec, 0);
  const x = PLAYER_X;
  const y = Math.round((CARD_H - lay.height) / 2);
  const cx = x + PLAYER_W / 2;

  // The surface: the mini player's dark card, lifted off the teal.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
  ctx.shadowBlur = 56;
  ctx.shadowOffsetY = 22;
  roundRect(ctx, x, y, PLAYER_W, lay.height, 32);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, PLAYER_W - 1, lay.height - 1, 32);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const ix = x + IN;
  let cy = y + IN - 2;

  // Now playing: the first article's tile, title and site.
  if (now) {
    const nowH = Math.max(NOW_TILE, lay.nowTitle.length * NOW_TITLE_LH + 6 + 24);
    drawTile(ctx, now, ix, cy + (nowH - NOW_TILE) / 2, NOW_TILE);
    const tx = ix + NOW_TILE + 20;
    const blockH = lay.nowTitle.length * NOW_TITLE_LH + 6 + 24;
    const by = cy + (nowH - blockH) / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.fg;
    ctx.font = `500 ${NOW_TITLE_PX}px ${SERIF}`;
    lay.nowTitle.forEach((l, i) => ctx.fillText(l, tx, by + 26 + i * NOW_TITLE_LH));
    ctx.fillStyle = C.muted;
    ctx.font = `400 20px ${SANS}`;
    ctx.fillText(oneLine(ctx, now.domain, IN_W - NOW_TILE - 20), tx, by + lay.nowTitle.length * NOW_TITLE_LH + 6 + 17);
    cy += nowH;
  }

  // Scrubber at the very start: the whole article is ready (the app's "rendered" tint), nothing played yet, and the clock says so.
  cy += 18;
  const barY = cy + 9;
  roundRect(ctx, ix, barY - 3, IN_W, 6, 3);
  ctx.fillStyle = 'rgba(143, 208, 195, 0.32)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + 9, barY, 9, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = `400 19px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('0:00', ix, cy + 18 + 18);
  if (now?.minutes) {
    ctx.textAlign = 'right';
    ctx.fillText(fmtClock(now.minutes), ix + IN_W, cy + 18 + 18);
    ctx.textAlign = 'left';
  }
  cy += 44 + 14;

  // Transport: skip back, the big round play button, skip forward. "Listen on Reader" is the button's label.
  const pcy = cy + PLAY_D / 2;
  skipIcon(ctx, SKIP_BACK, cx - 124, pcy, 44, 15);
  skipIcon(ctx, SKIP_FWD, cx + 124, pcy, 44, 15);
  ctx.save();
  ctx.shadowColor = 'rgba(143, 208, 195, 0.38)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 6;
  ctx.beginPath();
  ctx.arc(cx, pcy, PLAY_D / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.restore();
  glyph(ctx, PLAY_PATH, cx + 1.5, pcy, Math.round(PLAY_D * 0.52), { fill: C.onAccent });
  cy += PLAY_D + 8;
  ctx.fillStyle = C.accent;
  ctx.font = `600 26px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Listen on Reader', cx, cy + 26);
  ctx.textAlign = 'left';
  cy += 34;

  // Up next: the rest of the playlist as compact rows.
  if (lay.next.length) {
    cy += 8;
    ctx.fillStyle = C.line;
    ctx.fillRect(ix, cy, IN_W, 1);
    cy += 12;
    const minW = 76;
    for (const it of lay.next) {
      drawTile(ctx, it, ix, cy + (ROW_H - ROW_TILE) / 2, ROW_TILE);
      const tx = ix + ROW_TILE + 16;
      const textW = IN_W - ROW_TILE - 16 - minW;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = C.fg;
      ctx.font = `500 21px ${SERIF}`;
      ctx.fillText(oneLine(ctx, it.title, textW), tx, cy + 21);
      ctx.fillStyle = C.muted;
      ctx.font = `400 16px ${SANS}`;
      ctx.fillText(oneLine(ctx, it.domain, textW), tx, cy + 40);
      if (it.minutes) {
        ctx.font = `500 18px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${it.minutes} min`, ix + IN_W, cy + 29);
        ctx.textAlign = 'left';
      }
      cy += ROW_H;
    }
  }

  // Footer: "+2 more · 2 h 17 m total".
  // With one article the clock above is already the total, so the footer has nothing to add.
  const foot = footerText(lay.more, spec.total > 1 ? spec.totalMinutes : undefined);
  if (foot.more || foot.total) {
    cy += 6;
    const fy = cy + 22;
    ctx.font = `600 20px ${SANS}`;
    let fx = ix;
    if (foot.more) {
      ctx.fillStyle = C.accent;
      ctx.fillText(foot.more, fx, fy);
      fx += ctx.measureText(foot.more).width;
    }
    if (foot.total) {
      ctx.fillStyle = C.muted;
      ctx.font = `500 20px ${SANS}`;
      ctx.fillText(`${foot.more ? '  ·  ' : ''}${foot.total}`, fx, fy);
    }
  }
}

/** Renders the card to a PNG: our own small encoding where the browser can do it, canvas.toBlob otherwise. */
export async function renderCardBlob(spec: CardSpec): Promise<Blob> {
  await loadCardFonts(`${spec.headline} ${spec.items.map((i) => i.title).join(' ')}`);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawCard(ctx, spec);
  try {
    if (typeof CompressionStream === 'function') {
      return new Blob([await encodePng(ctx.getImageData(0, 0, CARD_W, CARD_H).data, CARD_W, CARD_H)], { type: 'image/png' });
    }
  } catch {
    /* fall through to the browser's encoder */
  }
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Couldn’t draw the card');
  return png;
}
