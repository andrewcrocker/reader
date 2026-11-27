/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { DOMParser as LinkedomParser } from 'linkedom';
import { db, domainOf, getSettings, nextQueueOrder } from './db';
import { classifyShare } from './app/share';
import { setHtmlParser } from './pipeline/dom';
import { fetchStep } from './pipeline/background';
import { chunksOnDevice, downloadChunks, releaseJob, ServerWaitError, submitPending } from './pipeline/serverSync';

// The app's service worker (SPEC §11b "Working while closed"). Besides caching the app shell, it
// finishes what the page would have done if it had stayed open:
//   - Share target: a shared link (or PDF) is saved and processed here, so closing the app right
//     after sharing doesn't stop it.
//   - Background Sync ("reader-work"): the page asks for this when it's hidden with work left.
//   - Periodic Background Sync ("reader-refresh"): Android Chrome wakes it every few hours.
// Each run: extract waiting articles, send them to the voice server, then download finished audio
// as MP3 bytes (a service worker can't decode audio; the page does that when it opens).

declare const self: ServiceWorkerGlobalScope;

// ---- App shell (what vite-plugin-pwa's generated worker used to do) ----

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/ort\//] }));
registerRoute(
  // ~21 MB ORT WASM runtime: cache on first use, not at install.
  ({ url }) => url.pathname.startsWith('/ort/'),
  new CacheFirst({ cacheName: 'ort-wasm', plugins: [new ExpirationPlugin({ maxEntries: 10 })] }),
);

// src/app/update.ts asks for this once nothing is playing.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

setHtmlParser((html) => new LinkedomParser().parseFromString(html, 'text/html') as unknown as Document);

// ---- Background work ----

/** Chrome lets an event run about five minutes; stop well before that. */
const BUDGET_MS = 4 * 60_000;

/** Does everything it can before `deadline`. Returns true if work is left that a later run could do. */
async function backgroundWork(deadline: number): Promise<boolean> {
  const out = () => Date.now() > deadline;
  const s = await getSettings();
  if (!s.proxySecret || s.engineKind !== 'server') return false;
  while (!out() && (await fetchStep())) {
    /* keep going */
  }
  if (!navigator.onLine) return true;
  await submitPending();
  // If the page is collecting at the same time, both may fetch a chunk; storing it twice is harmless.
  let left = false;
  const open = (await db.articles.orderBy('queueOrder').toArray()).filter((a) => a.serverJob && !a.deletedAt && !a.archivedAt);
  for (const a of open) {
    if (out()) return true;
    try {
      await downloadChunks(a, {
        isCancelled: () => false,
        shouldStop: out,
        onChunk: async (i, mp3) => void (await db.serverAudio.put({ articleId: a.id, i, mp3 })),
      });
      const fresh = await db.articles.get(a.id);
      if (fresh && (await chunksOnDevice(a.id)).size >= (fresh.chunks?.length ?? Infinity)) await releaseJob(fresh);
    } catch (err) {
      left = true;
      if (!(err instanceof ServerWaitError)) console.warn('background download failed', err);
    }
  }
  const stillWaiting = await db.articles
    .filter((a) => !a.deletedAt && (a.status === 'fetching' || a.status === 'waiting' || (a.status === 'extracted' && !a.serverJob && !a.busyUntil)))
    .count();
  return left || stillWaiting > 0;
}

/** Tells any open copy of the app to look again (it only checks on its own when opened or nudged). */
async function nudgePages(): Promise<void> {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'reader-work-done' });
}

let running: Promise<boolean> | null = null;
function work(): Promise<boolean> {
  running ??= backgroundWork(Date.now() + BUDGET_MS).finally(() => {
    running = null;
    void nudgePages();
  });
  return running;
}

interface SyncEvent extends ExtendableEvent {
  tag: string;
  lastChance: boolean;
}

self.addEventListener('sync', ((e: SyncEvent) => {
  if (e.tag !== 'reader-work') return;
  // Rejecting asks the browser to try again later (with backoff), while the server is still rendering.
  e.waitUntil(
    work().then((left) => {
      if (left && !e.lastChance) throw new Error('more to do');
    }),
  );
}) as EventListener);

self.addEventListener('periodicsync', ((e: SyncEvent) => {
  if (e.tag === 'reader-refresh') e.waitUntil(work());
}) as EventListener);

// ---- Share target (manifest: POST multipart to /share) ----

const MAX_FILE_BYTES = 50 * 1024 * 1024;

async function handleShare(e: FetchEvent): Promise<Response> {
  let form: FormData;
  try {
    form = await e.request.formData();
  } catch {
    return Response.redirect('/', 303);
  }
  const str = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : null);
  const file = form.getAll('file').find((f): f is File => f instanceof File && f.size > 0);
  const s = await getSettings();
  const base = { savedAt: Date.now(), sentences: [], positionSec: 0, voice: s.voice, ttsProvider: s.provider };

  if (file) {
    if (file.size > MAX_FILE_BYTES || !/pdf$/i.test(file.type || file.name)) return Response.redirect(`/share?unsupported=${encodeURIComponent(file.name)}`, 303);
    const id = crypto.randomUUID();
    await db.transaction('rw', db.articles, db.files, async () => {
      await db.files.put({ id, blob: file, name: file.name });
      await db.articles.add({ ...base, id, source: 'file', url: '', title: file.name.replace(/\.pdf$/i, ''), status: 'fetching', queueOrder: await nextQueueOrder() });
    });
    e.waitUntil(work());
    return Response.redirect(`/share?added=${id}`, 303);
  }

  const shared = classifyShare({ title: str('title'), text: str('text'), url: str('url') });
  if (shared?.kind === 'link') {
    const id = crypto.randomUUID();
    await db.articles.add({
      ...base,
      id,
      source: 'url',
      url: shared.url,
      domain: domainOf(shared.url),
      title: shared.title?.trim() || shared.url,
      status: navigator.onLine ? 'fetching' : 'waiting',
      queueOrder: await nextQueueOrder(),
    });
    e.waitUntil(work());
    return Response.redirect(`/share?added=${id}`, 303);
  }
  // Text waits for the person to tap Save, so hand it to the page as before.
  const q = new URLSearchParams();
  for (const k of ['title', 'text', 'url']) if (str(k)) q.set(k, str(k)!);
  return Response.redirect(`/share?${q}`, 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share') e.respondWith(handleShare(e));
});
