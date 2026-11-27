import { ExtractError, type Extracted } from './extract';
import type { Block } from './textprep';

// PDF -> listening blocks (SPEC §4b). pdf.js (via unpdf, which runs without a DOM, so the service
// worker can use it too) gives positioned runs of text. From those this rebuilds reading order and
// drops what nobody wants read aloud:
//   1. Runs -> lines, per page. Two-column pages are split at the gutter and read column by column.
//   2. Running headers/footers (repeated near the top/bottom of most pages) and page numbers go.
//   3. Footnote markers, tiny text (chart labels), and footnotes at the bottom of a page go.
//   4. Lines -> paragraphs by spacing, indents and short last lines; words hyphenated across lines
//      are rejoined. Larger or numbered short lines become headings.
//   5. Captions and table-like runs of numbers go. textprep then skips References etc. by heading.

/** About 3½ hours of listening; longer documents are cut here (and marked partial). */
export const MAX_PDF_CHARS = 150_000;

export interface TextRun {
  str: string;
  /** Left edge and baseline, in PDF points from the page's top-left. */
  x: number;
  top: number;
  width: number;
  size: number;
}

export interface PageText {
  width: number;
  height: number;
  runs: TextRun[];
}

interface Line {
  text: string;
  x0: number;
  x1: number;
  top: number;
  size: number;
  page: number;
  /** Which column (0 = full width or left, 1 = right), so breaks between columns aren't read as gaps. */
  col: number;
  /** Left/right edges of the column this line sits in. */
  colX0: number;
  colX1: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const clean = (s: string) =>
  s
    .normalize('NFKC') // ligatures (ﬁ, ﬂ) and full-width forms
    .replace(/­/g, '') // soft hyphens
    .replace(/[‐‑]/g, '-')
    .replace(/[\u0000-\u0008\u000b-\u001f�]/g, '')
    .replace(/\s+/g, ' ');

// ---------- 1. Runs -> lines ----------

/** Finds a two-column gutter: an x most body runs stay clear of, with plenty of text on both sides. */
export function findGutter(page: PageText, bodySize: number): number | null {
  const runs = page.runs.filter((r) => r.str.trim() && r.size >= bodySize * 0.8 && r.size <= bodySize * 1.25);
  if (runs.length < 20) return null;
  let best: { g: number; score: number } | null = null;
  for (let f = 0.35; f <= 0.65; f += 0.01) {
    const g = page.width * f;
    let left = 0;
    let right = 0;
    let cross = 0;
    for (const r of runs) {
      if (r.x + r.width < g) left++;
      else if (r.x > g) right++;
      else cross++;
    }
    if (left < 8 || right < 8 || cross > runs.length * 0.08) continue;
    const score = Math.min(left, right) - cross * 4;
    if (!best || score > best.score) best = { g, score };
  }
  return best?.g ?? null;
}

function runsToLines(runs: TextRun[], page: number, col: number, colX0: number, colX1: number): Line[] {
  const sorted = runs.filter((r) => r.str.length).sort((a, b) => a.top - b.top || a.x - b.x);
  const groups: TextRun[][] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    const ref = g?.[0];
    if (ref && Math.abs(r.top - ref.top) < Math.max(ref.size, r.size) * 0.5) g.push(r);
    else groups.push([r]);
  }
  const lines: Line[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    const size = Math.max(...g.map((r) => (r.str.trim() ? r.size : 0)));
    let text = '';
    let end = -Infinity;
    for (const r of g) {
      // Footnote markers and other superscripts: small and numeric (or a dagger).
      if (r.str.trim() && r.size < size * 0.78 && /^[\s\d,*†‡§¶–-]+$/.test(r.str)) continue;
      const gap = r.x - end;
      if (text && gap > size * 0.15 && !/\s$/.test(text) && !/^\s/.test(r.str)) text += ' ';
      text += r.str;
      end = Math.max(end, r.x + r.width);
    }
    text = clean(text).trim();
    if (!text) continue;
    const visible = g.filter((r) => r.str.trim());
    lines.push({
      text,
      x0: Math.min(...visible.map((r) => r.x)),
      x1: Math.max(...visible.map((r) => r.x + r.width)),
      top: g[0].top,
      size,
      page,
      col,
      colX0,
      colX1,
    });
  }
  return lines;
}

/** One page's lines in reading order: full-width bands top to bottom, each band's columns left then right. */
export function pageLines(page: PageText, index: number, bodySize: number): Line[] {
  const g = findGutter(page, bodySize);
  const all = runsToLines(page.runs, index, 0, 0, page.width);
  if (g === null) return withColumnEdges(all);
  const left: TextRun[] = [];
  const right: TextRun[] = [];
  const span: TextRun[] = [];
  for (const r of page.runs) {
    if (r.x + r.width <= g) left.push(r);
    else if (r.x >= g) right.push(r);
    else span.push(r);
  }
  const spans = runsToLines(span, index, 0, 0, page.width);
  // Bands split at each full-width line (title, abstract, a wide figure caption).
  const cuts = [-Infinity, ...spans.map((l) => l.top), Infinity];
  const L = runsToLines(left, index, 0, 0, g);
  const R = runsToLines(right, index, 1, g, page.width);
  const out: Line[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    if (k > 0) out.push(spans[k - 1]);
    const inBand = (l: Line) => l.top > cuts[k] && l.top < cuts[k + 1];
    out.push(...L.filter(inBand), ...R.filter(inBand));
  }
  return withColumnEdges(out);
}

const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

/** A column's edges are where most of its lines start and end (so short lines and indents stand out). */
function withColumnEdges(lines: Line[]): Line[] {
  for (const col of [0, 1]) {
    const ls = lines.filter((l) => l.col === col);
    if (!ls.length) continue;
    const x0 = median(ls.map((l) => l.x0));
    const x1 = percentile(ls.map((l) => l.x1), 0.8);
    for (const l of ls) {
      l.colX0 = x0;
      l.colX1 = x1;
    }
  }
  return lines;
}

// ---------- 2. Headers, footers, page numbers ----------

const PAGE_NUMBER = /^(page\s*)?(\d{1,4}|[ivxlcdm]{1,6})(\s*(of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;
const marginKey = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

export function dropMargins(pages: Line[][], heights: number[]): Line[][] {
  const zone = (l: Line) => l.top < heights[l.page] * 0.09 || l.top > heights[l.page] * 0.9;
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const l of lines) if (zone(l)) seen.add(marginKey(l.text));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeated = (k: string) => (counts.get(k) ?? 0) >= Math.max(2, pages.length * 0.3);
  return pages.map((lines) => lines.filter((l) => !(zone(l) && (PAGE_NUMBER.test(l.text) || repeated(marginKey(l.text)) || /^(arxiv:|doi:|https?:\/\/)/i.test(l.text)))));
}

// ---------- 3. Small print ----------

export function dropSmallPrint(pages: Line[][], bodySize: number): Line[][] {
  return pages.map((lines) => {
    const kept = lines.filter((l) => l.size >= bodySize * 0.7 || l.text.length > 120); // chart labels, stray marks
    // Footnotes: smaller text below the page's last body-size line.
    const lastBody = Math.max(...kept.filter((l) => l.size >= bodySize * 0.92).map((l) => l.top), -Infinity);
    return kept.filter((l) => !(l.size < bodySize * 0.9 && l.top > lastBody));
  });
}

// ---------- 4. Lines -> blocks ----------

const ENDS_SENTENCE = /[.!?:;"”’)\]]$/;
const KEEP_HYPHEN = /(^|\s)(self|non|well|cross|half|all|ex|quasi|anti|pre|post|co)-$/i;
const NUMBERED_HEADING = /^((\d{1,2}(\.\d{1,2}){0,3}\.?)|([IVX]{1,5}\.)|([A-H]\.))\s+\p{Lu}/u;
const CAPTION = /^(fig(ure)?|table|tab|chart|exhibit|plate|listing|algorithm)\.?\s*[\dIVX]+[a-z]?\s*[.:|—–-]/i;

function joinLines(a: string, b: string): string {
  if (/\p{Ll}-$/u.test(a) && /^\p{Ll}/u.test(b) && !KEEP_HYPHEN.test(a)) return a.slice(0, -1) + b;
  if (/[-–—/]$/.test(a)) return a + b;
  return `${a} ${b}`;
}

const looksLikeTable = (t: string) => {
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  return t.length < 300 && letters < t.replace(/\s/g, '').length * 0.45;
};

export function linesToBlocks(lines: Line[], bodySize: number): Block[] {
  // Typical line spacing for body text: the most common step between consecutive lines.
  const steps: number[] = [];
  for (let k = 1; k < lines.length; k++) {
    const [p, l] = [lines[k - 1], lines[k]];
    if (p.page === l.page && p.col === l.col && Math.abs(p.size - bodySize) < 1 && l.top > p.top) steps.push(l.top - p.top);
  }
  // Low percentile: paragraph gaps and headings only ever make steps larger.
  const step = (steps.length ? percentile(steps, 0.3) : 0) || bodySize * 1.25;

  const isHeading = (l: Line, next: Line | undefined) => {
    if (l.text.length > 120 || /[.,;]$/.test(l.text) || !/\p{L}/u.test(l.text)) return false;
    if (l.size >= bodySize * 1.15) return true;
    // "2.1 Methods" in body size, on a line of its own.
    return NUMBERED_HEADING.test(l.text) && l.text.length < 80 && (!next || next.top - l.top > step * 1.2 || next.page !== l.page || next.col !== l.col);
  };

  const blocks: Block[] = [];
  let buf = '';
  let kind: Block['kind'] = 'para';
  const flush = () => {
    const text = buf.trim();
    if (text && !(kind === 'para' && (CAPTION.test(text) || looksLikeTable(text)))) blocks.push({ kind, text });
    buf = '';
    kind = 'para';
  };

  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const prev = lines[k - 1];
    const next = lines[k + 1];
    const heading = isHeading(l, next);

    if (heading) {
      // Consecutive heading lines of the same size are one heading.
      if (kind === 'heading' && prev && Math.abs(prev.size - l.size) < 0.5 && l.top - prev.top < l.size * 2 && l.page === prev.page) {
        buf = joinLines(buf, l.text);
        continue;
      }
      flush();
      kind = 'heading';
      buf = l.text;
      continue;
    }
    if (kind === 'heading') flush();

    if (!buf) {
      buf = l.text;
      continue;
    }
    const sameFlow = prev && prev.page === l.page && prev.col === l.col;
    const gap = sameFlow ? l.top - prev.top : 0;
    const prevEnds = ENDS_SENTENCE.test(prev.text);
    const newPara = sameFlow
      ? gap > step * 1.45 || gap < 0 ||
        (prevEnds && l.x0 > l.colX0 + l.size * 0.9) || // first-line indent
        (prevEnds && prev.x1 < prev.colX1 - l.size * 3) || // short last line
        Math.abs(l.size - prev.size) > 1.5
      : // A page or column break: carry on mid-sentence, otherwise start fresh.
        prevEnds && !/^\p{Ll}/u.test(l.text);
    if (newPara) {
      flush();
      buf = l.text;
    } else buf = joinLines(buf, l.text);
  }
  flush();
  return blocks;
}

// ---------- Whole document ----------

const JUNK_TITLE = /^(untitled|microsoft (word|powerpoint)|document\d*|slide \d+|.*\.(pdf|docx?|pptx?|tex|indd|dvi))$|^(microsoft word|untitled)\s*-/i;

export function pickTitle(metaTitle: string | undefined, first: Line[], bodySize: number, fallback: string): string {
  const meta = metaTitle?.trim();
  if (meta && meta.length >= 4 && !JUNK_TITLE.test(meta)) return clean(meta).trim();
  // The largest text in the top half of page one.
  const top = first.filter((l) => l.top < (first[0]?.top ?? 0) + 400 && l.size > bodySize * 1.2 && /\p{L}{2}/u.test(l.text));
  if (top.length) {
    const max = Math.max(...top.map((l) => l.size));
    const t = top.filter((l) => Math.abs(l.size - max) < 0.5).slice(0, 3).map((l) => l.text).join(' ');
    if (t.length >= 4 && t.length <= 250) return t;
  }
  return fallback;
}

/** Positioned text for every page → title and listening blocks. Pure; tests feed it synthetic pages. */
export function pagesToBlocks(pages: PageText[], metaTitle?: string, fallbackTitle = 'PDF'): { title: string; blocks: Block[]; chars: number } {
  const sizes: number[] = [];
  for (const p of pages) for (const r of p.runs) for (let k = 0; k < Math.min(r.str.trim().length, 200); k++) sizes.push(Math.round(r.size * 2) / 2);
  const bodySize = median(sizes) || 10;

  let perPage = pages.map((p, i) => pageLines(p, i, bodySize));
  perPage = dropMargins(perPage, pages.map((p) => p.height));
  perPage = dropSmallPrint(perPage, bodySize);
  const title = pickTitle(metaTitle, perPage[0] ?? [], bodySize, fallbackTitle);
  let blocks = linesToBlocks(perPage.flat(), bodySize);
  // The intro reads the title; don't read it twice.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (blocks[0] && norm(blocks[0].text) === norm(title)) blocks = blocks.slice(1);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  return { title, blocks, chars };
}

/** Cuts the blocks at about `max` characters, on a block boundary. */
export function capBlocks(blocks: Block[], max = MAX_PDF_CHARS): { blocks: Block[]; cut: boolean } {
  let n = 0;
  for (let k = 0; k < blocks.length; k++) {
    n += blocks[k].text.length;
    if (n > max) return { blocks: blocks.slice(0, Math.max(1, k)), cut: true };
  }
  return { blocks, cut: false };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type PdfTextItem = { str?: string; transform?: number[]; width?: number; height?: number };

/** Reads a PDF's text with pdf.js. Errors are ExtractErrors a person can act on. */
export async function readPdfPages(bytes: Uint8Array): Promise<{ pages: PageText[]; metaTitle?: string; author?: string }> {
  const { getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    if (/password/i.test(msg)) throw new ExtractError('This PDF is password-protected.', 'page', true);
    throw new ExtractError('This PDF couldn’t be opened. It may be damaged.', 'page', true);
  }
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const runs: TextRun[] = [];
    for (const it of content.items as PdfTextItem[]) {
      const t = it.transform;
      if (!t || typeof it.str !== 'string') continue;
      // Rotated text: margin stamps, watermarks.
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
      const size = Math.hypot(t[2], t[3]) || it.height || 0;
      if (!size) continue;
      runs.push({ str: it.str, x: t[4] - vp.viewBox[0], top: vp.viewBox[3] - t[5], width: it.width ?? 0, size });
    }
    pages.push({ width: vp.width, height: vp.height, runs });
    page.cleanup();
  }
  let metaTitle: string | undefined;
  let author: string | undefined;
  try {
    const { info } = (await pdf.getMetadata()) as { info?: { Title?: string; Author?: string } };
    metaTitle = info?.Title;
    author = info?.Author?.trim() || undefined;
  } catch {
    /* no metadata */
  }
  void (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return { pages, metaTitle, author };
}

/** A PDF (fetched from a link or uploaded) as an article. */
export async function parsePdf(bytes: Uint8Array, opts: { finalUrl?: string; fileName?: string }): Promise<Extracted> {
  const { pages, metaTitle, author } = await readPdfPages(bytes);
  const fallback = opts.fileName?.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || (opts.finalUrl ? decodeURIComponent(new URL(opts.finalUrl).pathname.split('/').pop() ?? '').replace(/\.pdf$/i, '') : '') || 'PDF';
  const { title, blocks: all, chars } = pagesToBlocks(pages, metaTitle, fallback);
  if (chars < 200) {
    const scanned = pages.length > 0 && pages.every((p) => p.runs.filter((r) => r.str.trim()).length < 5);
    throw new ExtractError(scanned ? 'This PDF is a scan, so there’s no text to read.' : 'We couldn’t find any text in this PDF.', 'page', true);
  }
  const { blocks, cut } = capBlocks(all);
  const host = opts.finalUrl ? new URL(opts.finalUrl).hostname.replace(/^www\./, '') : undefined;
  return {
    finalUrl: opts.finalUrl ?? '',
    title,
    byline: author && author.length < 120 && !/^(admin|user|owner|unknown)$/i.test(author) ? author : undefined,
    siteName: host ?? 'PDF',
    contentHtml: blocks.map((b) => (b.kind === 'heading' ? `<h2>${escapeHtml(b.text)}</h2>` : `<p>${escapeHtml(b.text)}</p>`)).join(''),
    blocks,
    textLength: blocks.reduce((n, b) => n + b.text.length, 0),
    method: 'pdf',
    quality: cut ? 'partial' : 'full',
  };
}
