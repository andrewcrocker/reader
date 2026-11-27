import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { capBlocks, pagesToBlocks, parsePdf, type PageText, type TextRun } from './pdf';

// Synthetic pages: one run per line, width estimated from the text.
const run = (str: string, x: number, top: number, size = 10, width = str.length * size * 0.5): TextRun => ({ str, x, top, size, width });
const page = (runs: TextRun[], width = 612, height = 792): PageText => ({ width, height, runs });

const LOREM = [
  'The committee met on a rainy Tuesday to discuss the new library',
  'building, which had been delayed for almost two years by a series',
  'of disputes over the budget and the design of the reading room.',
];

/** A column of body lines starting at `top`, 12 pt apart. */
const body = (lines: string[], x: number, top: number) => lines.map((l, k) => run(l, x, top + k * 12));

describe('pagesToBlocks', () => {
  it('joins lines into paragraphs and splits on a blank gap', () => {
    const p = page([...body(LOREM, 72, 100), ...body(['A second paragraph starts here after a gap and keeps going for', 'a while longer.'], 72, 160)]);
    const { blocks } = pagesToBlocks([p]);
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'para']);
    expect(blocks[0].text).toBe(LOREM.join(' '));
  });

  it('rejoins words hyphenated across lines but keeps real hyphens', () => {
    const p = page(body(['This is a long sentence that ends with a hyphen-', 'ated word, and also a self-', 'aware one that should keep it.'], 72, 100));
    expect(pagesToBlocks([p]).blocks[0].text).toBe('This is a long sentence that ends with a hyphenated word, and also a self-aware one that should keep it.');
  });

  it('reads two columns left then right, with a full-width title on top', () => {
    const left = Array.from({ length: 12 }, (_, k) => `Left column line number ${k + 1} keeps going${k === 11 ? '.' : ''}`);
    const right = Array.from({ length: 12 }, (_, k) => `Right column line number ${k + 1} keeps going${k === 11 ? '.' : ''}`);
    const p = page([
      run('A Study of Columns in Documents', 120, 60, 18),
      ...left.map((l, k) => run(l, 54, 120 + k * 12, 10, 230)),
      ...right.map((l, k) => run(l, 324, 120 + k * 12, 10, 230)),
    ]);
    const { title, blocks } = pagesToBlocks([p]);
    expect(title).toBe('A Study of Columns in Documents');
    const text = blocks.map((b) => b.text).join(' ');
    expect(text.indexOf('Left column line number 12')).toBeLessThan(text.indexOf('Right column line number 1 '));
    expect(text).not.toMatch(/Left column line number 1 keeps going Right/);
  });

  it('drops running headers, page numbers and footnote markers', () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page([
        run('JOURNAL OF EXAMPLES, VOL. 3', 200, 40, 8),
        ...body([`Page ${n} text that is the real content of the page and goes`, 'on to the end of the sentence.'], 72, 100),
        run('1', 400, 97, 6, 3), // superscript marker, raised and small
        run(String(n), 300, 760, 9),
      ]),
    );
    const text = pagesToBlocks(pages).blocks.map((b) => b.text).join(' | ');
    expect(text).not.toMatch(/JOURNAL/);
    expect(text).not.toMatch(/\b[1-4]\s*\|/);
    expect(text).toContain('Page 3 text that is the real content');
    expect(text).not.toMatch(/goes\s*1/);
  });

  it('continues a sentence across a page break', () => {
    const a = page(body(['The argument begins on one page and does not', 'finish before the page runs out, so it'], 72, 600));
    const b = page(body(['continues on the next page, where it ends.'], 72, 100));
    expect(pagesToBlocks([a, b]).blocks.map((x) => x.text)).toEqual([
      'The argument begins on one page and does not finish before the page runs out, so it continues on the next page, where it ends.',
    ]);
  });

  it('finds headings by size or numbering, and drops captions and footnotes', () => {
    const p = page([
      run('Big Title Of The Paper', 100, 50, 20),
      run('1 Introduction', 72, 100, 10, 70),
      ...body(LOREM, 72, 125),
      run('Figure 2: A chart of the budget over time, by quarter.', 72, 180, 10),
      run('Results', 72, 210, 13),
      ...body(['Everything went well in the end, as expected by all of', 'the people involved.'], 72, 230),
      run('3 This footnote sits at the bottom in small print.', 72, 740, 7.5, 200),
    ]);
    const { blocks } = pagesToBlocks([p]);
    expect(blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['1 Introduction', 'Results']);
    const text = blocks.map((b) => b.text).join(' ');
    expect(text).not.toMatch(/Figure 2/);
    expect(text).not.toMatch(/footnote/);
    expect(blocks[0].text).not.toBe('Big Title Of The Paper'); // read by the intro instead
  });

  it('ignores junk metadata titles', () => {
    const p = page([run('Real Heading Of Document', 100, 60, 20), ...body(LOREM, 72, 120)]);
    expect(pagesToBlocks([p], 'Microsoft Word - draft3.docx').title).toBe('Real Heading Of Document');
    expect(pagesToBlocks([p], 'The Metadata Title').title).toBe('The Metadata Title');
  });
});

describe('capBlocks', () => {
  it('cuts on a block boundary', () => {
    const blocks = Array.from({ length: 10 }, () => ({ kind: 'para' as const, text: 'x'.repeat(100) }));
    expect(capBlocks(blocks, 450)).toEqual({ blocks: blocks.slice(0, 4), cut: true });
    expect(capBlocks(blocks, 5000).cut).toBe(false);
  });
});

describe('parsePdf (real PDF through pdf.js)', () => {
  it('reads a generated two-page PDF', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Notes on Reading Aloud');
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const para = [
      'Listening to an article is a different experience from reading it, and the',
      'difference matters most for long pieces that people save for later. A good',
      'voice and a clean text make the hour pass quickly, while stray page numbers',
      'and running headers break the spell every few minutes.',
    ];
    for (let n = 1; n <= 2; n++) {
      const p = doc.addPage([612, 792]);
      p.drawText('NOTES ON READING ALOUD', { x: 200, y: 750, size: 8, font });
      para.forEach((l, k) => p.drawText(l, { x: 72, y: 700 - k * 14, size: 11, font }));
      p.drawText(String(n), { x: 300, y: 30, size: 9, font });
    }
    const x = await parsePdf(await doc.save(), { fileName: 'notes.pdf' });
    expect(x.title).toBe('Notes on Reading Aloud');
    expect(x.method).toBe('pdf');
    expect(x.blocks).toHaveLength(2);
    expect(x.blocks![0].text).toMatch(/^Listening to an article .* every few minutes\.$/);
    expect(x.contentHtml).not.toMatch(/NOTES ON READING/);
  });

  it('says so when a PDF has no text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    await expect(parsePdf(await doc.save(), {})).rejects.toThrow(/scan|no text/i);
  });
});
