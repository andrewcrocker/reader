// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildScript, htmlToBlocks, introBlock, normalizeForSpeech, plainTextToBlocks, splitLong, splitSentences } from './textprep';

describe('htmlToBlocks', () => {
  it('keeps headings and paragraphs, drops figures, captions, tables, junk and footnotes', () => {
    const html = `
      <h2>The Setup</h2>
      <p>First paragraph with a note<sup><a href="#fn1">1</a></sup>. See https://example.com/x for more.</p>
      <figure><img src="a.jpg"><figcaption>Photo: Someone</figcaption></figure>
      <table><tr><td>cell</td></tr></table>
      <div class="newsletter-signup">Sign up for our newsletter</div>
      <p>Read more: Some other story</p>
      <pre><code>const x = 1;</code></pre>
      <ul><li>Item one</li><li>Item two</li></ul>
      <p>Mixed <em>inline</em> <a href="#">content</a> here.</p>`;
    const blocks = htmlToBlocks(html);
    expect(blocks).toEqual([
      { kind: 'heading', text: 'The Setup' },
      { kind: 'para', text: 'First paragraph with a note. See for more.' },
      { kind: 'para', text: 'Code sample omitted.' },
      { kind: 'para', text: 'Item one' },
      { kind: 'para', text: 'Item two' },
      { kind: 'para', text: 'Mixed inline content here.' },
    ]);
  });

  it('skips reference sections, edit links and hatnotes', () => {
    const blocks = htmlToBlocks(`
      <div class="hatnote">"X" redirects here.</div>
      <h2>History<span class="mw-editsection">edit</span></h2>
      <p>Body text.</p>
      <p>edit</p>
      <h2>References</h2><p>Smith, J. A Book. 1999.</p>
      <h2>External links</h2><p>Some site</p>`);
    expect(blocks).toEqual([
      { kind: 'heading', text: 'History' },
      { kind: 'para', text: 'Body text.' },
    ]);
  });

  it('does not drop a large container just because its class looks like junk', () => {
    const long = 'Real article text. '.repeat(50);
    const blocks = htmlToBlocks(`<div class="share-wrapper"><p>${long}</p></div>`);
    expect(blocks).toHaveLength(1);
  });
});

describe('plainTextToBlocks', () => {
  it('splits on blank lines and unwraps hard wraps', () => {
    expect(plainTextToBlocks('One line\nwrapped.\n\nSecond para.')).toEqual([
      { kind: 'para', text: 'One line wrapped.' },
      { kind: 'para', text: 'Second para.' },
    ]);
  });
});

describe('introBlock', () => {
  it('does not double punctuation', () => {
    expect(introBlock({ siteName: 'Acme, Inc.', title: 'T' })?.text).toBe('From Acme, Inc. T.');
  });

  it('builds "From site. Title. By author."', () => {
    expect(introBlock({ siteName: 'The Atlantic', title: 'A Title', byline: 'By Jane Doe' })?.text).toBe(
      'From The Atlantic. A Title. By Jane Doe.',
    );
  });
});

describe('splitSentences', () => {
  it('splits sentences and keeps honorific abbreviations attached', () => {
    expect(splitSentences('Dr. Smith arrived. He sat down! Did Mr. Jones?')).toEqual([
      'Dr. Smith arrived.',
      'He sat down!',
      'Did Mr. Jones?',
    ]);
  });

  it('keeps a multi-sentence quotation together', () => {
    expect(splitSentences('He wrote, "Fog all day. Bell rung." That was it.')).toEqual([
      'He wrote, "Fog all day. Bell rung."',
      'That was it.',
    ]);
    expect(splitSentences('She said, “Go now. Hurry.” Then left.')).toEqual(['She said, “Go now. Hurry.”', 'Then left.']);
  });
});

describe('splitLong', () => {
  it('splits at punctuation nearest the middle and respects the limit', () => {
    const s = 'This clause is fairly long and goes on, and this second clause is also fairly long indeed.';
    const parts = splitLong(s, 60);
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.length <= 60)).toBe(true);
    expect(parts.join(' ')).toBe(s);
  });
});

describe('normalizeForSpeech', () => {
  it('expands common symbols and abbreviations', () => {
    expect(normalizeForSpeech('Up 40% vs. last year, e.g. in Q3 & Q4.')).toBe(
      'Up 40 percent versus last year, for example, in Q3 and Q4.',
    );
  });
});

describe('buildScript', () => {
  it('groups up to N sentences per chunk within a block and maps sentence indices', () => {
    const { sentences, chunks } = buildScript(
      [
        { kind: 'intro', text: 'From X. Title.' },
        { kind: 'para', text: 'One. Two. Three. Four.' },
      ],
      { maxSentencesPerChunk: 3, maxChars: 260 },
    );
    expect(sentences.map((s) => s.text)).toEqual(['From X. Title.', 'One.', 'Two.', 'Three.', 'Four.']);
    expect(chunks.map((c) => [c.text, c.sentenceStart, c.sentenceCount])).toEqual([
      ['From X. Title.', 0, 1],
      ['One. Two. Three.', 1, 3],
      ['Four.', 4, 1],
    ]);
    expect(chunks[0].pauseAfter).toBeGreaterThan(chunks[1].pauseAfter);
  });

  it('never exceeds maxChars per chunk', () => {
    const para = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has a handful of words in it.`).join(' ');
    const { chunks } = buildScript([{ kind: 'para', text: para }], { maxSentencesPerChunk: 3, maxChars: 120 });
    expect(chunks.every((c) => c.text.length <= 120)).toBe(true);
  });
});
