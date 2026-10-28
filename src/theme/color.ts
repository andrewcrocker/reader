// Small color toolkit: sRGB hex <-> OKLCH, WCAG contrast, and the article-tint clamp
// from DESIGN.md "Article tint". No dependencies; numbers follow Björn Ottosson's OKLab.

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

type Rgb = [number, number, number]; // 0..1, gamma-encoded sRGB

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH -> sRGB hex, reducing chroma until the color fits in gamut. */
export function oklchToHex(o: Oklch): string {
  let c = o.c;
  for (let i = 0; i < 40; i++) {
    const lin = oklchToLinear({ ...o, c });
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(toGamma) as Rgb);
    c *= 0.92;
  }
  return rgbToHex(oklchToLinear({ ...o, c: 0 }).map(toGamma) as Rgb);
}

export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex));
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Composite a translucent color over an opaque background (for checking wash contrast). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

// ---- Theme tokens the tint is checked against (DESIGN "Color") ----
export const THEME = {
  light: { bg: '#F4F2EE', accent: '#1F5C55', onAccent: '#F4F2EE' },
  dark: { bg: '#151412', accent: '#8FD0C3', onAccent: '#0F2420' },
} as const;

export interface TintSet {
  tint: string;
  onTint: string;
  /** Text on washes and on `bg`. */
  ink: string;
  /** Pill background (tint at 10% / 14%). */
  wash: string;
  /** Buffered/rendered scrubber segment (tint at 38%). */
  rendered: string;
  /** True when the art was near-neutral and we fell back to `accent`. */
  fallback: boolean;
}

export interface ArticleTint {
  light: TintSet;
  dark: TintSet;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function accentSet(mode: 'light' | 'dark'): TintSet {
  const t = THEME[mode];
  return {
    tint: t.accent,
    onTint: t.onAccent,
    ink: t.accent,
    wash: withAlpha(t.accent, mode === 'light' ? 0.1 : 0.14),
    rendered: withAlpha(t.accent, 0.38),
    fallback: true,
  };
}

/**
 * DESIGN "Article tint": clamp the art's color so playback controls stay calm and legible.
 * Steps 1–5: neutral fallback, chroma cap, per-theme lightness band, derived tokens, contrast check.
 */
export function articleTint(source: string | undefined): ArticleTint {
  if (!source || !/^#?[0-9a-f]{3,6}$/i.test(source)) return { light: accentSet('light'), dark: accentSet('dark') };
  const o = hexToOklch(source);
  if (o.c < 0.03) return { light: accentSet('light'), dark: accentSet('dark') };
  const c = Math.min(o.c, 0.1);
  return { light: tintFor('light', o.h, c, clamp(o.l, 0.3, 0.45)), dark: tintFor('dark', o.h, c, clamp(o.l, 0.78, 0.86)) };
}

function tintFor(mode: 'light' | 'dark', h: number, c: number, l: number): TintSet {
  const bg = THEME[mode].bg;
  // Step 5: step L toward the extreme until both pairs pass 4.5:1.
  for (let i = 0; i < 30; i++) {
    const tint = oklchToHex({ l, c, h });
    const onTint = mode === 'light' ? bg : oklchToHex({ l: 0.2, c: 0.04, h });
    const ink = mode === 'light' ? tint : oklchToHex({ l: Math.min(0.98, l + 0.04), c, h });
    if (contrast(onTint, tint) >= 4.5 && contrast(ink, bg) >= 4.5) {
      return {
        tint,
        onTint,
        ink,
        wash: withAlpha(tint, mode === 'light' ? 0.1 : 0.14),
        rendered: withAlpha(tint, 0.38),
        fallback: false,
      };
    }
    l = mode === 'light' ? l - 0.02 : l + 0.02;
  }
  return accentSet(mode);
}

/** DESIGN "Artwork": a domain with no art gets one of 8 muted hues at L 0.40–0.50, C 0.08. */
export function domainColor(domain: string | undefined): string {
  const key = domain || 'pasted';
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = [20, 60, 100, 150, 195, 235, 280, 330][hash % 8];
  const l = 0.4 + ((hash >>> 8) % 11) / 100;
  return oklchToHex({ l, c: 0.08, h: hue });
}

/** A light tone of the same hue for text on a generated cover. */
export function coverInk(bgHex: string): string {
  const o = hexToOklch(bgHex);
  if (o.l > 0.62) return oklchToHex({ l: 0.2, c: Math.min(o.c, 0.05), h: o.h });
  return oklchToHex({ l: 0.95, c: Math.min(o.c, 0.03), h: o.h });
}
