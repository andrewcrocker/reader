import { describe, expect, it } from 'vitest';
import { articleTint, contrast, coverInk, domainColor, hexToOklch, oklchToHex, THEME } from './color';

describe('oklch round trip', () => {
  it('returns the same hex for in-gamut colors', () => {
    for (const hex of ['#2E4057', '#5B2A6E', '#1F5C55', '#E9C46A', '#B4532A']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});

describe('articleTint (DESIGN "Article tint")', () => {
  it('falls back to accent for near-neutral art (The Margin black)', () => {
    const t = articleTint('#151515');
    expect(t.light.fallback).toBe(true);
    expect(t.light.tint).toBe(THEME.light.accent);
    expect(t.dark.tint).toBe(THEME.dark.accent);
  });

  it('keeps an in-band light tint as-is (Civic Ledger slate)', () => {
    const t = articleTint('#2E4057');
    expect(t.light.fallback).toBe(false);
    expect(t.light.tint).toBe('#2E4057');
  });

  it('produces a light dark-theme tint near the worked examples', () => {
    const slate = hexToOklch(articleTint('#2E4057').dark.tint);
    expect(slate.l).toBeGreaterThanOrEqual(0.775); // hex rounding
    expect(slate.l).toBeLessThanOrEqual(0.9);
    expect(slate.c).toBeLessThanOrEqual(0.1 + 1e-6);
    const plum = hexToOklch(articleTint('#5B2A6E').dark.tint);
    expect(Math.abs(plum.h - hexToOklch('#D9BEE6').h)).toBeLessThan(15);
  });

  it('always meets 4.5:1 for on-tint and ink on bg', () => {
    for (const src of ['#2E4057', '#5B2A6E', '#E9C46A', '#B4532A', '#2A6F75', '#FF0000', '#00FF88', '#FFFF00']) {
      const t = articleTint(src);
      for (const mode of ['light', 'dark'] as const) {
        expect(contrast(t[mode].onTint, t[mode].tint)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t[mode].ink, THEME[mode].bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('caps chroma at 0.10', () => {
    expect(hexToOklch(articleTint('#FF0000').light.tint).c).toBeLessThanOrEqual(0.1 + 1e-3);
  });
});

describe('domainColor', () => {
  it('is stable per domain and within the muted band', () => {
    expect(domainColor('example.com')).toBe(domainColor('example.com'));
    const o = hexToOklch(domainColor('curbside.press'));
    expect(o.l).toBeGreaterThanOrEqual(0.39);
    expect(o.l).toBeLessThanOrEqual(0.51);
  });

  it('gives readable cover ink', () => {
    for (const bg of ['#2E4057', '#E9C46A', domainColor('a.com'), domainColor('b.org')]) {
      expect(contrast(coverInk(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
