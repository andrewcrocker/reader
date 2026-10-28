import { db, getSettings, nextQueueOrder, type Article } from '../db';
import { deleteAudio } from '../audio/storage';
import { getSharedEngine } from '../tts/engine';
import { buildScript, htmlToBlocks, introBlock, plainTextToBlocks, type Block } from './textprep';
import { fetchHtml, parseArticle } from './extract';
import { renderArticle } from './render';

// Single sequential worker loop: fetch/extract, then render, oldest first.
// Called on launch, after adding, and when the network comes back (§4 step 4, §11a).

export type EngineState =
  | { phase: 'idle' }
  | { phase: 'loading'; message: string; loaded?: number; total?: number }
  | { phase: 'ready'; device: string; dtype: string; fallbackReason?: string }
  | { phase: 'error'; message: string };

let engineState: EngineState = { phase: 'idle' };
const listeners = new Set<(s: EngineState) => void>();
export function onEngineState(fn: (s: EngineState) => void): () => void {
  listeners.add(fn);
  fn(engineState);
  return () => listeners.delete(fn);
}
function setEngineState(s: EngineState) {
  engineState = s;
  listeners.forEach((fn) => fn(s));
}

let running = false;
let again = false;
const cancelled = new Set<string>();

export async function addUrl(url: string): Promise<string> {
  const id = crypto.randomUUID();
  const settings = await getSettings();
  await db.articles.add({
    id,
    url,
    title: url,
    savedAt: Date.now(),
    status: 'fetching',
    sentences: [],
    positionSec: 0,
    queueOrder: await nextQueueOrder(),
    voice: settings.voice,
    ttsProvider: settings.provider,
  });
  void kick();
  return id;
}

export async function addText(text: string, title?: string): Promise<string> {
  const id = crypto.randomUUID();
  const settings = await getSettings();
  const blocks = plainTextToBlocks(text);
  const firstWords = blocks[0]?.text.split(/\s+/).slice(0, 8).join(' ') ?? 'Pasted text';
  const finalTitle = title?.trim() || `${firstWords}…`;
  const script = buildScript(withIntro(blocks, { title: title?.trim() }));
  await db.articles.add({
    id,
    url: '',
    title: finalTitle,
    savedAt: Date.now(),
    status: 'extracted',
    extractionMethod: 'pasted',
    pastedText: text,
    contentHtml: blocks.map((b) => `<p>${escapeHtml(b.text)}</p>`).join(''),
    sentences: script.sentences,
    chunks: script.chunks,
    positionSec: 0,
    queueOrder: await nextQueueOrder(),
    voice: settings.voice,
    ttsProvider: settings.provider,
  });
  void kick();
  return id;
}

export async function deleteArticle(id: string): Promise<void> {
  cancelled.add(id);
  const a = await db.articles.get(id);
  await db.transaction('rw', db.articles, db.renderedChunks, async () => {
    await db.articles.delete(id);
    await db.renderedChunks.where('articleId').equals(id).delete();
  });
  if (a?.audioKey) await deleteAudio(a.audioKey);
}

export async function retryArticle(id: string): Promise<void> {
  const a = await db.articles.get(id);
  if (!a) return;
  await db.articles.update(id, { status: a.chunks?.length ? 'extracted' : 'fetching', error: undefined });
  void kick();
}

export async function kick(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  const wakeLock = await requestWakeLock();
  try {
    do {
      again = false;
      while (await step()) {
        /* keep going */
      }
    } while (again);
  } finally {
    running = false;
    await wakeLock?.release().catch(() => {});
  }
}

/** Does one unit of work. Returns false when there is nothing left to do. */
async function step(): Promise<boolean> {
  const pending = (await db.articles.orderBy('queueOrder').toArray()).filter(
    (a) => (a.status === 'fetching' && navigator.onLine) || a.status === 'extracted' || a.status === 'rendering',
  );
  const next = pending[0];
  if (!next) return false;
  cancelled.delete(next.id);

  try {
    if (next.status === 'fetching') await extract(next);
    else await render(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (await db.articles.get(next.id)) await db.articles.update(next.id, { status: 'failed', error: message });
  }
  return true;
}

async function extract(a: Article) {
  const settings = await getSettings();
  const { html, finalUrl } = await fetchHtml(a.url, settings);
  const x = parseArticle(html, finalUrl);
  const script = buildScript(withIntro(htmlToBlocks(x.contentHtml), x));
  if (!script.chunks.length) throw new Error('Extracted article has no readable text.');
  await db.articles.update(a.id, {
    status: 'extracted',
    title: x.title,
    byline: x.byline,
    siteName: x.siteName,
    imageUrl: x.imageUrl,
    canonicalUrl: x.canonicalUrl,
    contentHtml: x.contentHtml,
    extractionMethod: x.method,
    sentences: script.sentences,
    chunks: script.chunks,
  });
}

async function render(a: Article) {
  const settings = await getSettings();
  await db.articles.update(a.id, { status: 'rendering', renderProgress: a.renderProgress ?? 0 });
  const { engine, ready } = getSharedEngine(settings.engine, {
    onStatus: (message) => setEngineState({ phase: 'loading', message }),
    onProgress: (file, loaded, total) =>
      setEngineState({ phase: 'loading', message: `Loading ${file.split('/').pop()}`, loaded, total }),
  });
  if (engineState.phase !== 'ready') setEngineState({ phase: 'loading', message: 'Loading voice model…' });
  try {
    const info = await ready;
    setEngineState({ phase: 'ready', device: info.device, dtype: info.dtype, fallbackReason: info.fallbackReason });
  } catch (err) {
    setEngineState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  await renderArticle(a, engine, () => cancelled.has(a.id));
}

function withIntro(blocks: Block[], meta: { title?: string; byline?: string; siteName?: string }): Block[] {
  const intro = introBlock(meta);
  return intro ? [intro, ...blocks] : blocks;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  // Rendering stops if the page is backgrounded, so keep the screen on while it runs.
  try {
    if (document.visibilityState === 'visible' && 'wakeLock' in navigator) return await navigator.wakeLock.request('screen');
  } catch {
    /* not granted; render anyway */
  }
  return null;
}

export function startRunner(): void {
  window.addEventListener('online', () => void kick());
  void kick();
}
