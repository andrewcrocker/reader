import { describe, expect, it } from 'vitest';
import { classifyShare, readHash } from './share';

describe('classifyShare', () => {
  it('uses the url field when present', () => {
    expect(classifyShare({ url: 'https://a.com/x', title: 'T', text: 'whatever' })).toEqual({ kind: 'link', url: 'https://a.com/x', title: 'T' });
  });
  it('treats a lone URL in text as a link', () => {
    expect(classifyShare({ text: 'https://a.com/x' })).toEqual({ kind: 'link', url: 'https://a.com/x', title: undefined });
  });
  it('treats "Headline https://…" as a link with the headline as title', () => {
    expect(classifyShare({ text: 'Why bike lanes look the same - https://n.city/lanes.' })).toEqual({ kind: 'link', url: 'https://n.city/lanes', title: 'Why bike lanes look the same' });
  });
  it('treats long text, or text with several links, as text', () => {
    const long = `${'word '.repeat(80)}https://a.com/x`;
    expect(classifyShare({ text: long })?.kind).toBe('text');
    expect(classifyShare({ text: 'see https://a.com and https://b.com', title: 'Notes' })).toEqual({ kind: 'text', text: 'see https://a.com and https://b.com', title: 'Notes' });
  });
  it('returns null for an empty share', () => {
    expect(classifyShare({ text: '  ' })).toBeNull();
  });
});

describe('readHash', () => {
  it('reads invite and add', () => {
    expect(readHash('#invite=s3cret')).toEqual({ invite: 's3cret', add: undefined });
    expect(readHash('#add=https%3A%2F%2Fa.com%2Fx')).toEqual({ invite: undefined, add: 'https://a.com/x' });
  });
});
