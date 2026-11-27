import { plural } from '../format';
import { coverInk } from '../theme/color';
import { HEART_PATH } from '../ui/heart';
import { encodePng } from './png';

// The share card (SPEC §4 "Sharing a reading list"): a 1200x630 PNG drawn on a <canvas> in the app. It's the
// preview in the share sheet and the image attached to the link, so it has to read as a small thumbnail in a
// chat: the headline, the play mark and the first title are big, and everything else is detail for the full
// size. It reads as "a playlist you can press play on": Reader's teal on the left with the headline, and on
// the right Reader's own player (the mini player's dark surface) holding the first article under a play mark,
// a scrubber, and the next few articles as roomy rows.

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
const PLAYER_X = 580;
const PLAYER_W = CARD_W - PLAYER_X - 56;
const PLAYER_MAX_H = CARD_H - 2 * 24;
const LEFT_W = PLAYER_X - 52 - PAD;
const IN = 32; // padding inside the player
const IN_W = PLAYER_W - IN * 2;
// The first article ("now playing"). Alone, it is the whole player, so it is drawn larger.
interface NowSize {
  tile: number;
  gap: number; // tile to title
  px: number; // title
  lh: number;
  subPx: number;
  sub: number; // title baseline to site baseline
}
const NOW: NowSize = { tile: 100, gap: 22, px: 34, lh: 40, subPx: 21, sub: 29 };
const NOW_SOLO: NowSize = { tile: 136, gap: 28, px: 40, lh: 46, subPx: 22, sub: 34 };
const ROW_TILE = 66;
const ROW_GAP_X = 20; // tile to title
const ROW_GAP_Y = 22; // between rows
const ROW_TITLE_PX = 26;
const ROW_TITLE_LH = 31;
const MAX_NEXT = 3;

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

/** The player's footer: "+ 2 more", or nothing when every article is shown. */
export function moreText(more: number): string {
  return more > 0 ? `+ ${more} more` : '';
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

/** A row's second line, "paulgraham.com · 48 min". A long domain is cut with an ellipsis; the length stays. */
export function subline(measure: (s: string) => number, domain: string, minutes: number | undefined, maxW: number): string {
  const tail = minutes ? ` · ${minutes} min` : '';
  const site = wrapText(measure, domain, Math.max(0, maxW - measure(tail)), 1, false)[0] ?? '';
  return site + tail;
}

/**
 * How many rows fit in `room`. `heights` are the rows on offer, `gap` goes between rows, and `footer` is what
 * the "+ N more" line takes, wanted whenever any article is left out (`leftOver` counts the ones not on offer).
 */
export function rowsThatFit(heights: number[], room: number, gap: number, footer: number, leftOver: number): number {
  for (let n = heights.length; n > 0; n--) {
    const rows = heights.slice(0, n).reduce((sum, h) => sum + h, 0) + (n - 1) * gap;
    if (rows + (leftOver + heights.length - n > 0 ? footer : 0) <= room) return n;
  }
  return 0;
}

/** Draws a glyph from the icon set (a 24x24 path) at `size`, centered on (cx, cy). */
function glyph(ctx: Ctx, d: string, cx: number, cy: number, size: number, o: { fill?: string } = {}) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill(new Path2D(d));
  }
  ctx.restore();
}

// The play triangle from src/ui/Icon.tsx, so the mark looks like the app's.
const PLAY_PATH = 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z';

/** A domain on one line, cut to `maxW` with an ellipsis. */
function oneLine(ctx: Ctx, text: string, maxW: number): string {
  return wrapText((t) => ctx.measureText(t).width, text, maxW, 1, false)[0] ?? '';
}

/**
 * The play mark on the "now playing" tile: a round accent badge with a dark triangle, the app's own play button
 * in small. It says "press play" and reads over any art (a white tile included) and at thumbnail size.
 */
function drawPlayMark(ctx: Ctx, x: number, y: number, size: number) {
  const d = Math.round(size * 0.68);
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  roundRect(ctx, x, y, size, size, Math.round(size * 0.22));
  ctx.clip();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  glyph(ctx, PLAY_PATH, cx, cy, Math.round(d * 0.62), { fill: C.onAccent });
  ctx.restore();
}

interface Row {
  item: CardItem;
  title: string[];
  h: number;
}

interface PlayerLayout {
  now: NowSize;
  nowTitle: string[];
  /** Height of the "now playing" block, and of the zone it and the scrubber make. */
  nowH: number;
  topH: number;
  rows: Row[];
  more: number;
  height: number;
}

// Vertical rhythm, in px. Text blocks are measured from the cap height of their first line to just below the last baseline.
const TOP_PAD = 26;
const SCRUB_GAP = 22; // now playing to the scrubber
const SCRUB_H = 42; // bar and clock
const ZONE_PAD = 24; // the scrubber to the foot of the top zone
const LIST_GAP = 24; // the top zone to the first row
const FOOT_GAP = 22;
const FOOT_PX = 22;
const BOTTOM_PAD = 28;
const SUB_PX = 18;

/** A block of `lines` title lines and a second line under it: how tall it is from the cap height of the first line. */
const blockH = (lines: number, px: number, lh: number, sub: number) => Math.round(px * 0.7) + (lines - 1) * lh + sub + 5;

/** How tall the player is, and how many rows fit under the first article: as many as the card has room for, up to `MAX_NEXT`. */
function layoutPlayer(ctx: Ctx, spec: CardSpec): PlayerLayout {
  const { now, next: offered } = playlistSplit(spec, MAX_NEXT);
  const size = spec.total > 1 ? NOW : NOW_SOLO;
  ctx.font = `500 ${size.px}px ${SERIF}`;
  const nowTitle = now ? wrapText((t) => ctx.measureText(t).width, now.title, IN_W - size.tile - size.gap, 2) : [];
  const nowH = Math.max(size.tile, blockH(nowTitle.length, size.px, size.lh, size.sub));
  const topH = TOP_PAD + nowH + SCRUB_GAP + SCRUB_H + ZONE_PAD;

  ctx.font = `500 ${ROW_TITLE_PX}px ${SERIF}`;
  const all: Row[] = offered.map((item) => {
    const title = wrapText((t) => ctx.measureText(t).width, item.title, IN_W - ROW_TILE - ROW_GAP_X, 2);
    return { item, title, h: Math.max(ROW_TILE, blockH(title.length, ROW_TITLE_PX, ROW_TITLE_LH, 28)) };
  });
  const room = PLAYER_MAX_H - topH - LIST_GAP - BOTTOM_PAD;
  const n = rowsThatFit(all.map((r) => r.h), room, ROW_GAP_Y, FOOT_GAP + FOOT_PX, spec.total - 1 - offered.length);
  const rows = all.slice(0, n);
  const more = playlistSplit(spec, n).more;
  // With no rows the first article is the whole player: the scrubber's padding is the player's.
  const height = rows.length ? topH + LIST_GAP + rows.reduce((sum, r) => sum + r.h, 0) + (rows.length - 1) * ROW_GAP_Y + (more ? FOOT_GAP + FOOT_PX : 0) + BOTTOM_PAD : topH - ZONE_PAD + BOTTOM_PAD;
  return { now: size, nowTitle, nowH, topH, rows, more, height };
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
  const eyebrow = `${spec.rangeLabel} · ${plural(spec.total, 'article')}`.toUpperCase();
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

/** The player: the first article with a play mark on its tile, a scrubber, and the next few articles as rows. */
function drawPlayer(ctx: Ctx, spec: CardSpec) {
  const lay = layoutPlayer(ctx, spec);
  const { now } = playlistSplit(spec, 0);
  const x = PLAYER_X;
  const y = Math.round((CARD_H - lay.height) / 2);
  const ix = x + IN;

  // The surface: the mini player's dark card, lifted off the teal.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
  ctx.shadowBlur = 56;
  ctx.shadowOffsetY = 22;
  roundRect(ctx, x, y, PLAYER_W, lay.height, 32);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.restore();
  // The first article and its scrubber sit on a slightly lighter step than the playlist below.
  if (lay.rows.length) {
    ctx.save();
    roundRect(ctx, x, y, PLAYER_W, lay.height, 32);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x, y, PLAYER_W, lay.topH);
    ctx.restore();
  }
  roundRect(ctx, x + 0.5, y + 0.5, PLAYER_W - 1, lay.height - 1, 32);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();

  let cy = y + TOP_PAD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Now playing: the first article's tile with the play mark on it, and its title and site.
  if (now) {
    const n = lay.now;
    const tileY = cy + (lay.nowH - n.tile) / 2;
    drawTile(ctx, now, ix, tileY, n.tile);
    drawPlayMark(ctx, ix, tileY, n.tile);
    const tx = ix + n.tile + n.gap;
    const textH = blockH(lay.nowTitle.length, n.px, n.lh, n.sub);
    const first = cy + (lay.nowH - textH) / 2 + Math.round(n.px * 0.7);
    ctx.fillStyle = C.fg;
    ctx.font = `500 ${n.px}px ${SERIF}`;
    lay.nowTitle.forEach((l, i) => ctx.fillText(l, tx, first + i * n.lh));
    ctx.fillStyle = C.muted;
    ctx.font = `400 ${n.subPx}px ${SANS}`;
    ctx.fillText(oneLine(ctx, now.domain, IN_W - n.tile - n.gap), tx, first + (lay.nowTitle.length - 1) * n.lh + n.sub);
  }
  cy += lay.nowH + SCRUB_GAP;

  // Scrubber at the very start: the whole article is ready (the app's "rendered" tint), nothing played yet, and the clock says so.
  const barY = cy + 8;
  roundRect(ctx, ix, barY - 3, IN_W, 6, 3);
  ctx.fillStyle = 'rgba(143, 208, 195, 0.32)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ix + 8, barY, 8, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = `400 19px ${SANS}`;
  ctx.fillText('0:00', ix, cy + 38);
  if (now?.minutes) {
    ctx.textAlign = 'right';
    ctx.fillText(fmtClock(now.minutes), ix + IN_W, cy + 38);
    ctx.textAlign = 'left';
  }
  cy = y + lay.topH + LIST_GAP;

  // The playlist: a roomy row per article. Tiles share one left edge and titles another.
  const tx = ix + ROW_TILE + ROW_GAP_X;
  const textW = IN_W - ROW_TILE - ROW_GAP_X;
  for (const row of lay.rows) {
    const textH = blockH(row.title.length, ROW_TITLE_PX, ROW_TITLE_LH, 28);
    // Short titles centre on the tile; two lines start level with its top.
    drawTile(ctx, row.item, ix, cy, ROW_TILE);
    const first = cy + Math.max(0, (row.h - textH) / 2) + Math.round(ROW_TITLE_PX * 0.7);
    ctx.fillStyle = C.fg;
    ctx.font = `500 ${ROW_TITLE_PX}px ${SERIF}`;
    row.title.forEach((l, i) => ctx.fillText(l, tx, first + i * ROW_TITLE_LH));
    ctx.fillStyle = C.muted;
    ctx.font = `400 ${SUB_PX}px ${SANS}`;
    ctx.fillText(subline((t) => ctx.measureText(t).width, row.item.domain, row.item.minutes, textW), tx, first + (row.title.length - 1) * ROW_TITLE_LH + 28);
    cy += row.h + ROW_GAP_Y;
  }

  // Footer: "+ 2 more", level with the titles.
  if (lay.more) {
    ctx.fillStyle = C.accent;
    ctx.font = `600 ${FOOT_PX}px ${SANS}`;
    ctx.fillText(moreText(lay.more), tx, cy - ROW_GAP_Y + FOOT_GAP + FOOT_PX - 4);
  }
}

/** The card as a PNG, from the canvas it was drawn on: our own small encoding where the browser can do it, canvas.toBlob otherwise. */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  try {
    const ctx = canvas.getContext('2d');
    if (ctx && typeof CompressionStream === 'function') {
      return new Blob([await encodePng(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)], { type: 'image/png' });
    }
  } catch {
    /* fall through to the browser's encoder */
  }
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Couldn’t draw the card');
  return png;
}
