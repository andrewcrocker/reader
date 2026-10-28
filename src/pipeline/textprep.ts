import type { Chunk, Sentence } from '../db';

// Readability HTML (or pasted text) -> listening script: sentences for display/timing,
// chunks of normalized text for the TTS engine.

export type BlockKind = 'intro' | 'heading' | 'para';
export interface Block {
  kind: BlockKind;
  text: string;
}

export interface Script {
  sentences: Sentence[];
  chunks: Chunk[];
}

export interface ChunkOptions {
  maxSentencesPerChunk: number;
  maxChars: number;
}

export const DEFAULT_CHUNKING: ChunkOptions = { maxSentencesPerChunk: 3, maxChars: 260 };

const PAUSE = { sentence: 0.25, para: 0.55, heading: 0.85, intro: 1.0 } as const;

const DROP_SELECTOR = [
  'figure', 'figcaption', 'picture', 'img', 'video', 'audio', 'iframe', 'object', 'embed',
  'table', 'svg', 'canvas', 'math', 'script', 'style', 'noscript', 'template', 'form',
  'button', 'input', 'select', 'textarea', 'nav', 'aside', 'footer',
].join(',');

const JUNK_ATTR = /\b(related|newsletter|signup|sign-up|subscribe|promo|advert|ad-slot|ad-container|sponsor|share|social|caption|credit|byline|read-more|readmore|recirc|outbrain|taboola|hatnote|mw-editsection|navbox|reflist|references)\b/i;

// Sections that are never worth listening to; skipped until the next unrelated heading.
const SKIP_SECTION = /^(references|notes|footnotes|citations|sources|bibliography|further reading|external links|see also|works cited)$/i;

const JUNK_PARA = [
  /^(read more|related|see also|more from|recommended|advertisement|sponsored)\b/i,
  /^(sign up|subscribe)\b.*\b(newsletter|inbox|email|updates)\b/i,
  /\bsign up for (our|the) .*newsletter\b/i,
  /^(click|tap) here\b/i,
  /^(photo|image|illustration|video)( credit)?:/i,
  /^share (this|on)\b/i,
];

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DL', 'DT', 'DD',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR', 'PRE', 'DETAILS', 'SUMMARY',
]);

export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;

  body.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove());
  body.querySelectorAll<HTMLElement>('[class],[id]').forEach((el) => {
    const attrs = `${el.getAttribute('class') ?? ''} ${el.id}`;
    // Only drop small containers; a "share" class on the article root shouldn't wipe the text.
    if (JUNK_ATTR.test(attrs) && (el.textContent ?? '').length < 600) el.remove();
  });
  // Footnote markers: <sup>1</sup>, <sup><a>[2]</a></sup>
  body.querySelectorAll('sup').forEach((el) => {
    if (/^\s*\[?[\d*†‡,\s-]+\]?\s*$/.test(el.textContent ?? '') || el.querySelector('a')) el.remove();
  });
  body.querySelectorAll('pre').forEach((el) => {
    const p = doc.createElement('p');
    p.textContent = 'Code sample omitted.';
    el.replaceWith(p);
  });

  const blocks: Block[] = [];
  let buf = '';
  const flush = (kind: BlockKind = 'para') => {
    const text = cleanText(buf);
    buf = '';
    if (!text) return;
    if (kind === 'para' && JUNK_PARA.some((re) => re.test(text)) && text.length < 200) return;
    if (kind === 'para' && !/[\p{L}\p{N}]/u.test(text)) return;
    // Stray UI fragments ("edit", "Share", "Advertisement") rather than prose.
    if (kind === 'para' && !/\s/.test(text) && !/[.!?]$/.test(text)) return;
    blocks.push({ kind, text });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buf += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (/^H[1-6]$/.test(el.tagName)) {
      flush();
      buf = el.textContent ?? '';
      flush('heading');
      return;
    }
    const isBlock = BLOCK_TAGS.has(el.tagName);
    if (isBlock) flush();
    el.childNodes.forEach(walk);
    if (isBlock) flush();
    else if (el.tagName === 'LI') flush();
  };
  walk(body);
  flush();

  const kept: Block[] = [];
  let skipping = false;
  for (const b of blocks) {
    if (b.kind === 'heading') skipping = SKIP_SECTION.test(b.text.replace(/[\s:]+$/, ''));
    if (!skipping) kept.push(b);
  }
  return kept;
}

export function plainTextToBlocks(text: string): Block[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n|\n(?=\s*[-*•]\s)/);
  const blocks: Block[] = [];
  for (const raw of paras) {
    // Single newlines inside a pasted paragraph are usually hard wraps.
    const text = cleanText(raw.replace(/\n/g, ' ').replace(/^\s*[-*•]\s+/, ''));
    if (text) blocks.push({ kind: 'para', text });
  }
  return blocks;
}

export function introBlock(meta: { title?: string; byline?: string; siteName?: string }): Block | null {
  const parts: string[] = [];
  if (meta.siteName) parts.push(`From ${endWithPunct(meta.siteName.trim())}`);
  if (meta.title) parts.push(endWithPunct(meta.title.trim()));
  const by = meta.byline?.trim().replace(/^by\s+/i, '');
  if (by && by.length < 120) parts.push(`By ${endWithPunct(by)}`);
  return parts.length ? { kind: 'intro', text: parts.join(' ') } : null;
}

function endWithPunct(s: string): string {
  return /[.!?…"”']$/.test(s) ? s : `${s}.`;
}

function cleanText(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/\[(\d+|[a-z]|citation needed|edit)\]/gi, '') // wiki-style markers
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/** Text tweaks for the TTS engine only; displayed sentences keep the original wording. */
export function normalizeForSpeech(s: string): string {
  return s
    .replace(/\be\.g\.,?/gi, 'for example,')
    .replace(/\bi\.e\.,?/gi, 'that is,')
    .replace(/\bvs\.?(?=\s)/gi, 'versus')
    .replace(/\bapprox\.(?=\s)/gi, 'approximately')
    .replace(/\bNo\.\s?(?=\d)/g, 'number ')
    .replace(/(\d)\s?%/g, '$1 percent')
    .replace(/\s&\s/g, ' and ')
    .replace(/~\s?(?=\d)/g, 'about ')
    .replace(/(\d)\s?[x×]\s?(?=\d)/g, '$1 by ')
    .replace(/\s+[/|]\s+/g, ', ')
    .replace(/[*_#^<>{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|Inc|Ltd|Co|Corp|Gen|Gov|Sen|Rep|Lt|Col|Capt|Sgt|No|Fig|Vol|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|e\.g|i\.e)\.|\b[A-Z]\.)$/;

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('en', { granularity: 'sentence' })
  : null;

export function splitSentences(text: string): string[] {
  const raw = segmenter
    ? [...segmenter.segment(text)].map((s) => s.segment.trim()).filter(Boolean)
    : text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  // ICU splits after abbreviations like "Dr." and inside quotations — stitch those back together.
  const out: string[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && (ABBREV.test(prev) || openQuote(prev))) out[out.length - 1] = `${prev} ${s}`;
    else out.push(s);
  }
  return out;
}

function openQuote(s: string): boolean {
  const straight = (s.match(/"/g) ?? []).length;
  const opens = (s.match(/“/g) ?? []).length;
  const closes = (s.match(/”/g) ?? []).length;
  return straight % 2 === 1 || opens > closes;
}

/** Splits a too-long sentence at the punctuation nearest its middle, recursively. */
export function splitLong(s: string, maxChars: number): string[] {
  if (s.length <= maxChars) return [s];
  const mid = s.length / 2;
  let best = -1;
  const re = /[;:,—–)](?=\s)|\s(?=[—–(])/g;
  for (const m of s.matchAll(re)) {
    const at = m.index! + m[0].length;
    if (best < 0 || Math.abs(at - mid) < Math.abs(best - mid)) best = at;
  }
  if (best <= 0 || best >= s.length - 1) {
    // No punctuation: split at the space nearest the middle.
    const left = s.lastIndexOf(' ', mid);
    best = left > 0 ? left : s.indexOf(' ', mid);
    if (best <= 0) return [s.slice(0, maxChars), ...splitLong(s.slice(maxChars), maxChars)];
  }
  return [...splitLong(s.slice(0, best).trim(), maxChars), ...splitLong(s.slice(best).trim(), maxChars)];
}

export function buildScript(blocks: Block[], opts: ChunkOptions = DEFAULT_CHUNKING): Script {
  const sentences: Sentence[] = [];
  const chunks: Chunk[] = [];

  for (const block of blocks) {
    const pieces = (block.kind === 'para' ? splitSentences(block.text) : [block.text])
      .flatMap((s) => splitLong(s, opts.maxChars));

    let group: string[] = [];
    let groupStart = sentences.length;
    const emit = (last: boolean) => {
      if (!group.length) return;
      chunks.push({
        i: chunks.length,
        text: normalizeForSpeech(group.join(' ')),
        sentenceStart: groupStart,
        sentenceCount: group.length,
        pauseAfter: last ? PAUSE[block.kind] : PAUSE.sentence,
      });
      group = [];
    };

    for (const piece of pieces) {
      const len = group.join(' ').length;
      if (group.length >= opts.maxSentencesPerChunk || (group.length && len + 1 + piece.length > opts.maxChars)) {
        emit(false);
      }
      if (!group.length) groupStart = sentences.length;
      sentences.push({ i: sentences.length, text: piece });
      group.push(piece);
    }
    emit(true);
  }
  return { sentences, chunks };
}

export function wordCount(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
}
