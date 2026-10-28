import { useEffect, useState } from 'react';
import { db, getSettings, type Article } from '../db';
import { domainColor, hexToOklch, rgbToHex } from '../theme/color';

// SPEC §4a. Artwork is fetched once through the proxy, downscaled to ≤512 px, and stored as a
// blob so every art slot (and the lock screen) works offline.

const MAX = 512;

async function fetchAsset(url: string): Promise<Blob | null> {
  const s = await getSettings();
  try {
    const res = await fetch(`${s.proxyUrl.replace(/\/$/, '')}/asset?url=${encodeURIComponent(url)}`, {
      headers: { 'X-App-Secret': s.proxySecret },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith('image/') && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** Downscale (and optionally center-crop to square). Returns the new blob and its dominant color. */
async function process(blob: Blob, square: boolean): Promise<{ blob: Blob; color?: string; w: number; h: number } | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return null; // undecodable (e.g. .ico on some browsers)
  }
  const sw = bmp.width;
  const sh = bmp.height;
  const side = Math.min(sw, sh);
  const [cx, cy, cw, ch] = square ? [(sw - side) / 2, (sh - side) / 2, side, side] : [0, 0, sw, sh];
  const scale = Math.min(1, MAX / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * scale));
  const h = Math.max(1, Math.round(ch * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, w, h);
  bmp.close();
  const color = dominantColor(ctx, w, h);
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 }).catch(() => canvas.convertToBlob({ type: 'image/png' }));
  return { blob: out, color, w, h };
}

/** Most common non-neutral color, sampled on a coarse grid and bucketed by hue (DESIGN "Article tint"). */
function dominantColor(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): string | undefined {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 32));
  const { data } = ctx.getImageData(0, 0, w, h);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let opaque = 0;
  let neutral = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      opaque++;
      const hex = rgbToHex([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]);
      const o = hexToOklch(hex);
      if (o.c < 0.03 || o.l < 0.12 || o.l > 0.97) {
        neutral++;
        continue;
      }
      const key = Math.round(o.h / 20);
      const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      // Weight by chroma so a saturated accent beats a faintly tinted background.
      const wgt = 0.5 + o.c * 4;
      bk.n += wgt;
      bk.r += data[i] * wgt;
      bk.g += data[i + 1] * wgt;
      bk.b += data[i + 2] * wgt;
      buckets.set(key, bk);
    }
  }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  // Mostly-neutral art (a black logo on white) falls back to accent via the tint clamp.
  if (!best || !opaque || neutral / opaque > 0.85) return undefined;
  return rgbToHex([best.r / best.n / 255, best.g / best.n / 255, best.b / best.n / 255]);
}

async function storeFrom(url: string, key: string, square: boolean, minSide: number): Promise<string | undefined> {
  const existing = await db.art.get(key);
  if (existing) return existing.color ?? '';
  const raw = await fetchAsset(url);
  if (!raw) return undefined;
  const p = await process(raw, square);
  if (!p || Math.min(p.w, p.h) < minSide) return undefined;
  await db.art.put({ key, blob: p.blob, color: p.color });
  return p.color ?? '';
}

/**
 * Fetch article art and site art for an article, then set the tint source.
 * Never throws: art is decoration, a failure leaves the generated cover.
 */
export async function fetchArtwork(a: Article): Promise<void> {
  try {
    const patch: Partial<Article> = {};
    let articleColor: string | undefined;
    let siteColor: string | undefined;

    if (a.imageUrl) {
      const key = `article:${a.id}`;
      const c = await storeFrom(a.imageUrl, key, true, 120);
      if (c !== undefined) {
        patch.articleArtKey = key;
        articleColor = c || undefined;
      }
    }
    if (a.domain) {
      const key = `site:${a.domain}`;
      const candidates = [a.iconUrl, a.url ? new URL('/apple-touch-icon.png', a.url).toString() : undefined].filter(Boolean) as string[];
      for (const url of candidates) {
        const c = await storeFrom(url, key, true, 96);
        if (c !== undefined) {
          patch.siteArtKey = key;
          siteColor = c || undefined;
          break;
        }
      }
    }
    // Source color of the art shown in Now Playing; with no art, the generated cover's color.
    patch.tintSource = articleColor ?? (patch.articleArtKey ? undefined : siteColor) ?? (patch.articleArtKey || patch.siteArtKey ? undefined : domainColor(a.domain));
    if (await db.articles.get(a.id)) await db.articles.update(a.id, patch);
  } catch (err) {
    console.warn('artwork failed', err);
  }
}

/** Delete art no longer referenced (article art always; site art when no article uses the domain). */
export async function purgeArt(a: Article): Promise<void> {
  if (a.articleArtKey) await db.art.delete(a.articleArtKey);
  if (a.siteArtKey) {
    const others = await db.articles.where('domain').equals(a.domain ?? '').filter((x) => x.id !== a.id).count();
    if (!others) await db.art.delete(a.siteArtKey);
  }
}

// ---- Object URLs for stored art, shared and ref-counted across components ----

const urls = new Map<string, { url: string; refs: number }>();

export function useArtUrl(key: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (key ? urls.get(key)?.url : undefined));
  useEffect(() => {
    if (!key) {
      setUrl(undefined);
      return;
    }
    let live = true;
    const cached = urls.get(key);
    if (cached) {
      cached.refs++;
      setUrl(cached.url);
    } else {
      void db.art.get(key).then((row) => {
        if (!live || !row) return;
        const existing = urls.get(key);
        if (existing) {
          existing.refs++;
          setUrl(existing.url);
        } else {
          const u = URL.createObjectURL(row.blob);
          urls.set(key, { url: u, refs: 1 });
          setUrl(u);
        }
      });
    }
    return () => {
      live = false;
      const entry = urls.get(key);
      if (!entry) return;
      entry.refs--;
      if (entry.refs <= 0) {
        // Keep briefly so remounts (row -> mini player -> Now Playing) don't flash.
        setTimeout(() => {
          const e = urls.get(key);
          if (e && e.refs <= 0) {
            URL.revokeObjectURL(e.url);
            urls.delete(key);
          }
        }, 5000);
      }
    };
  }, [key]);
  return url;
}

/** Initials for small generated covers: 1–3 characters (DESIGN "Artwork"). */
export function initials(name: string | undefined): string {
  if (!name) return '·';
  const clean = name.replace(/^(the|a|an)\s+/i, '').replace(/\.(com|org|net|blog|press|io|co|news)$/i, '');
  if (/&/.test(clean)) {
    const parts = clean.split(/\s*&\s*/);
    return parts.map((p) => p[0]).join('&').toUpperCase().slice(0, 3);
  }
  const words = clean.split(/[\s.\-_]+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.[0] ?? '·').toUpperCase();
}

/** Rasterize the generated cover to a 512 px PNG for the Media Session (lock screen needs an image URL). */
export async function rasterCover(title: string, site: string | undefined, bg: string, ink: string): Promise<Blob | null> {
  try {
    const c = new OffscreenCanvas(512, 512);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.8;
    ctx.font = '600 16px "IBM Plex Sans", sans-serif';
    ctx.fillText((site ?? '').toUpperCase().slice(0, 32), 38, 60);
    ctx.globalAlpha = 1;
    ctx.font = '500 46px Literata, Georgia, serif';
    const words = title.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > 436 && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 6);
    let y = 512 - 40 - (shown.length - 1) * 52;
    for (const l of shown) {
      ctx.fillText(l, 38, y);
      y += 52;
    }
    return await c.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}
