import type { Lookup, RenderChunk } from './render';

// The shared voice cache (spec/VOICE_CACHE.md). A chunk's MP3 is kept at cache/<voice>/<hash>.mp3 in the
// AUDIO bucket, where <hash> covers the version below, the voice and the chunk's exact text. A later
// article with the same chunk skips the voice host and the daily budget. Only types come from render.ts,
// so render.ts can import this file.

/**
 * Bump by hand when what the voice host returns changes for the same text: a new model behind the
 * unpinned `hexgrad/Kokoro-82M`, other request settings, or different MP3 post-processing (stripHeaderFrames).
 * Old entries stop matching and age out.
 */
export const VOICE_CACHE_VERSION = 'v1';

/**
 * Entries older than this count as misses and get re-rendered (which refreshes them). Keep it a week
 * or more under the lifecycle rule on cache/ (README: 180 days), so audio a job points at can't expire
 * before the app has downloaded it.
 */
export const CACHE_TRUST_MS = 170 * 86_400_000;

/** R2 lookups in flight at once; a request can wait on only six connections anyway. */
const LOOKUP_PARALLEL = 6;

/** The object key for a chunk: sha256 over version, voice and the exact text sent to the voice host, under a per-voice folder. */
export async function cacheKey(voice: string, text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VOICE_CACHE_VERSION}\n${voice}\n${text}`)));
  return `cache/${voice}/${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}.mp3`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/**
 * Looks each chunk up in the cache. A lookup carries `sec` (the length stored with the audio) and `bytes`
 * only for a hit; every lookup carries the chunk's key. `missChars` is what the voice host will be asked
 * to say, which is all the daily budget is charged for. A lookup that fails counts as a miss.
 * Runs in the quota counter (a Durable Object), not in /render: up to 400 lookups and hashes are too much
 * CPU for a free-plan request.
 */
export async function planRender(
  bucket: Pick<R2Bucket, 'head'>,
  voice: string,
  chunks: RenderChunk[],
  now: number,
): Promise<{ lookups: Lookup[]; missChars: number }> {
  const lookups = await mapLimit(chunks, LOOKUP_PARALLEL, async (c): Promise<Lookup> => {
    const key = await cacheKey(voice, c.text);
    const found = await bucket.head(key).catch(() => null);
    const sec = Number(found?.customMetadata?.sec);
    if (found && sec > 0 && now - found.uploaded.getTime() < CACHE_TRUST_MS) return { i: c.i, key, sec, bytes: found.size };
    return { i: c.i, key };
  });
  const hit = new Set(lookups.filter((l) => l.sec !== undefined).map((l) => l.i));
  return { lookups, missChars: chunks.reduce((n, c) => n + (hit.has(c.i) ? 0 : c.text.length), 0) };
}

/** Hits (to list in the manifest) and misses (to render, each carrying its cache key), in chunk order. */
export function splitLookups(chunks: RenderChunk[], lookups: Lookup[]): { hits: (Lookup & { sec: number })[]; misses: RenderChunk[] } {
  const byIndex = new Map(lookups.map((l) => [l.i, l]));
  const hits: (Lookup & { sec: number })[] = [];
  const misses: RenderChunk[] = [];
  for (const c of chunks) {
    const l = byIndex.get(c.i);
    if (l?.sec !== undefined) hits.push({ ...l, sec: l.sec });
    else misses.push(l ? { i: c.i, text: c.text, key: l.key } : c);
  }
  return { hits, misses };
}

/** What one /render saved, for the log line the owner reads to size the cache. */
export function cacheStats(chunks: RenderChunk[], lookups: Lookup[]) {
  const { hits, misses } = splitLookups(chunks, lookups);
  const len = new Map(chunks.map((c) => [c.i, c.text.length]));
  return {
    chunks: chunks.length,
    hits: hits.length,
    misses: misses.length,
    charsSaved: hits.reduce((n, h) => n + (len.get(h.i) ?? 0), 0),
    charsCharged: misses.reduce((n, m) => n + m.text.length, 0),
    bytesSaved: hits.reduce((n, h) => n + (h.bytes ?? 0), 0),
  };
}
