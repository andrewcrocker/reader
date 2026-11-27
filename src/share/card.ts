import { coverInk } from '../theme/color';
import { encodePng } from './png';

// The share card (spec/SHARING.md): a 1200x630 PNG drawn on a <canvas> in the app, so the Worker needs
// no image rendering. It's what shows when the link is pasted into iMessage, Slack, X or Discord, so
// the headline is big enough to read as a thumbnail and everything else is detail for the full size.
// Always dark: dark is the app's primary theme, and it stands out on both light and dark feeds.

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
  items: CardItem[];
}

// DESIGN "Color": the dark column for the list panel, and the app's own teal (`accent`, light theme)
// as the ground, so a pasted link reads as Reader before anyone reads a word.
const C = {
  ground: '#1f5c55',
  ink: '#f3f2f0',
  inkSoft: '#cde8e2',
  panel: '#151413',
  fg: '#e8e6e3',
  muted: '#a2a09b',
  accent: '#8fd0c3',
  onAccent: '#0f2420',
  // The app icon: amber play mark on near-black.
  markBg: '#14161a',
  markFg: '#f2b84b',
};
const SERIF = '"Literata", Georgia, "Times New Roman", serif';
const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

// Layout. The headline gets the left column, the list the right.
const PAD = 72;
const LEFT_W = 520;
const PANEL_X = 628;
const PANEL_W = CARD_W - PANEL_X - 60;
const PANEL_PAD = 28;
const TILE = 56;
const TITLE_PX = 26;
const TITLE_LH = 32;
const META_PX = 19;
const META_LH = 24;
const ROW_GAP = 20;
const MORE_H = 44;
const MAX_ROWS = 5;

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
 * Greedy word wrap. A hyphenated word may break after its hyphen, a word wider than the line is split by
 * characters, and if the text doesn't fit in `maxLines` the last line is cut at a word and ends in an ellipsis.
 */
export function wrapText(measure: (s: string) => number, text: string, maxW: number, maxLines: number): string[] {
  // Pieces to place: each word, and each part of a hyphenated word, which sticks to the part before it.
  const pieces: { t: string; glue: boolean }[] = [];
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)) {
    (word.match(/[^-]+-*|-+/g) ?? [word]).forEach((part, k) => pieces.push({ t: part, glue: k > 0 }));
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

const STAR = 'M12 3.6L14.65 9.16L20.75 9.96L16.28 14.19L17.41 20.24L12 17.3L6.59 20.24L7.72 14.19L3.25 9.96L9.35 9.16z';

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
  const words = domain.replace(/^www\./, '').replace(/\.(com|org|net|io|co|dev|blog|news|me|limo)$/i, '').split(/[\s.\-_]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const mark = words.length >= 2 ? words[0][0] + words[1][0] : (words[0]?.[0] ?? '·');
  return mark.toUpperCase();
}

function drawTile(ctx: Ctx, it: CardItem, x: number, y: number) {
  ctx.save();
  roundRect(ctx, x, y, TILE, TILE, 13);
  ctx.clip();
  if (it.art) {
    const src = it.art as { width?: number; height?: number };
    const sw = src.width ?? TILE;
    const sh = src.height ?? TILE;
    const side = Math.min(sw, sh);
    ctx.fillStyle = '#2f2d2b';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.drawImage(it.art, (sw - side) / 2, (sh - side) / 2, side, side, x, y, TILE, TILE);
  } else {
    ctx.fillStyle = it.tint;
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = coverInk(it.tint);
    ctx.font = `600 22px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsOf(it.domain), x + TILE / 2, y + TILE / 2 + 1);
  }
  ctx.restore();
}

interface Row {
  item: CardItem;
  title: string[];
  height: number;
}

/** The most rows (3 to 5, fewer if the list is shorter) that fit in `avail` px, wrapping each title to at most two lines. */
function layoutRows(ctx: Ctx, spec: CardSpec, avail: number): { rows: Row[]; more: number; height: number } {
  ctx.font = `500 ${TITLE_PX}px ${SERIF}`;
  const textW = PANEL_W - PANEL_PAD * 2 - TILE - 18;
  const measure = (s: string) => ctx.measureText(s).width;
  const all = spec.items.slice(0, MAX_ROWS).map<Row>((item) => {
    const title = wrapText(measure, item.title, textW, 2);
    return { item, title, height: Math.max(TILE, title.length * TITLE_LH + 4 + META_LH) };
  });
  const floor = Math.min(3, all.length);
  for (let n = all.length; n >= floor; n--) {
    const rows = all.slice(0, n);
    const more = spec.total - n;
    const height = rows.reduce((h, r) => h + r.height, 0) + ROW_GAP * (n - 1) + (more > 0 ? MORE_H : 0);
    if (height <= avail || n === floor) return { rows, more, height };
  }
  return { rows: [], more: spec.total, height: 0 };
}

/** Draws the card into a 1200x630 context. Fonts must already be loaded (`loadCardFonts`). */
export function drawCard(ctx: Ctx, spec: CardSpec): void {
  ctx.save();
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Ground: Reader's teal, lit from the top right (behind the list) and shaded toward the bottom left.
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const lit = ctx.createRadialGradient(PANEL_X + PANEL_W / 2, 120, 0, PANEL_X + PANEL_W / 2, 120, 700);
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

  // Headline: the largest size that wraps without losing words and clears the pill below it.
  const pillY = CARD_H - 64 - 56;
  const eyebrow = `${spec.rangeLabel} · ${spec.total} ${spec.total === 1 ? 'article' : 'articles'}`.toUpperCase();
  let size = 88;
  let lines: string[] = [];
  let lh = 0;
  let top = 0;
  for (; size >= 52; size -= 4) {
    ctx.font = `500 ${size}px ${SERIF}`;
    lines = wrapText((t) => ctx.measureText(t).width, spec.headline, LEFT_W, size >= 72 ? 3 : 4);
    lh = Math.round(size * 1.06);
    // The eyebrow and headline sit centered between the brand and the pill.
    top = Math.max(150, Math.round((CARD_H - (56 + lines.length * lh)) / 2) - 18);
    if ((!lines.at(-1)?.endsWith('…') && top + 56 + lines.length * lh <= pillY - 24) || size <= 52) break;
  }

  const star = new Path2D(STAR);
  ctx.save();
  ctx.translate(PAD - 2, top - 2);
  ctx.scale(1.25, 1.25);
  ctx.fillStyle = C.inkSoft;
  ctx.strokeStyle = C.inkSoft;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.fill(star);
  ctx.stroke(star);
  ctx.restore();
  ctx.fillStyle = C.inkSoft;
  ctx.font = `600 24px ${SANS}`;
  tracked(ctx, eyebrow, PAD + 42, top + 24, 2.6);

  ctx.fillStyle = C.ink;
  ctx.font = `500 ${size}px ${SERIF}`;
  const headTop = top + 30 + 26;
  lines.forEach((l, i) => ctx.fillText(l, PAD, headTop + size * 0.84 + i * lh));

  // "Listen on Reader": the app's player look (an accent circle with a play mark) on its dark surface.
  const label = 'Listen on Reader';
  ctx.font = `600 24px ${SANS}`;
  const pillW = 14 + 40 + 14 + ctx.measureText(label).width + 28;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, PAD, pillY, pillW, 56, 28);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(PAD + 14 + 20, pillY + 28, 20, 0, Math.PI * 2);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(PAD + 14 + 15, pillY + 18);
  ctx.lineTo(PAD + 14 + 15, pillY + 38);
  ctx.lineTo(PAD + 14 + 31, pillY + 28);
  ctx.closePath();
  ctx.fillStyle = C.onAccent;
  ctx.fill();
  ctx.fillStyle = C.fg;
  ctx.fillText(label, PAD + 14 + 40 + 14, pillY + 37);

  // The list panel, as tall as its rows need, centered.
  const { rows, more, height } = layoutRows(ctx, spec, CARD_H - 2 * 56 - 2 * PANEL_PAD);
  const panelH = Math.min(CARD_H - 2 * 48, height + PANEL_PAD * 2);
  const panelY = Math.round((CARD_H - panelH) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, PANEL_X, panelY, PANEL_W, panelH, 28);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.restore();

  let y = panelY + PANEL_PAD;
  const x = PANEL_X + PANEL_PAD;
  for (const row of rows) {
    // Center the tile against the text when the title is one line.
    const ty = y + Math.max(0, (row.height - TILE) / 2);
    drawTile(ctx, row.item, x, ty);
    const tx = x + TILE + 18;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.fg;
    ctx.font = `500 ${TITLE_PX}px ${SERIF}`;
    const blockTop = y + (row.height - (row.title.length * TITLE_LH + 4 + META_LH)) / 2;
    row.title.forEach((l, i) => ctx.fillText(l, tx, blockTop + 24 + i * TITLE_LH));
    ctx.fillStyle = C.muted;
    ctx.font = `400 ${META_PX}px ${SANS}`;
    const meta = [row.item.domain, row.item.minutes ? `${row.item.minutes} min` : undefined].filter(Boolean).join(' · ');
    const metaLine = wrapText((t) => ctx.measureText(t).width, meta, PANEL_W - PANEL_PAD * 2 - TILE - 18, 1)[0] ?? '';
    ctx.fillText(metaLine, tx, blockTop + row.title.length * TITLE_LH + 4 + 17);
    y += row.height + ROW_GAP;
  }
  if (more > 0) {
    ctx.fillStyle = C.accent;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(`+ ${more} more`, x + TILE + 18, y - ROW_GAP + 34);
  }
  ctx.restore();
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
