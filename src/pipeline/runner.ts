import { db, domainOf, getSettings, nextQueueOrder, updateSettings, type Article, type VoiceQuality } from '../db';
import { deleteAudio } from '../audio/storage';
import { fetchArtwork, purgeArt } from '../art/art';
import { getSharedEngine } from '../tts/engine';
import { buildScript, htmlToBlocks, introBlock, plainTextToBlocks, type Block } from './textprep';
import { fetchHtml, parseArticle } from './extract';
import { renderArticle } from './render';

// Single sequential worker loop: fetch/extract, then render, in queue order.
// Called on launch, after adding, and when the network comes back (SPEC §4, §11a).

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

class EngineError extends Error {}

let running = false;
let again = false;
const cancelled = new Set<string>();

const isOnline = () => navigator.onLine;

export async function addUrl(url: string, provisionalTitle?: string): Promise<string> {
  const id = crypto.randomUUID();
  const settings = await getSettings();
  await db.articles.add({
    id,
    source: 'url',
    url,
    domain: domainOf(url),
    title: provisionalTitle?.trim() || url,
    savedAt: Date.now(),
    status: isOnline() ? 'fetching' : 'waiting',
    sentences: [],
    positionSec: 0,
    queueOrder: await nextQueueOrder(),
    voice: settings.voice,
    ttsProvider: settings.provider,
  });
  void kick();
  return id;
}

function textScript(text: string, title?: string) {
  const blocks = plainTextToBlocks(text);
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  const fallback = firstLine.length && firstLine.length <= 120 ? firstLine : `${blocks[0]?.text.split(/\s+/).slice(0, 8).join(' ') ?? 'Pasted text'}…`;
  const finalTitle = title?.trim() || fallback;
  // If the first line became the title, don't read it twice.
  const body = !title?.trim() && blocks[0]?.text === firstLine && blocks.length > 1 ? blocks.slice(1) : blocks;
  const script = buildScript(withIntro(body, { title: finalTitle }));
  return { finalTitle, body, script };
}

export async function addText(text: string, title?: string): Promise<string> {
  const id = crypto.randomUUID();
  const settings = await getSettings();
  const { finalTitle, body, script } = textScript(text, title);
  await db.articles.add({
    id,
    source: 'text',
    url: '',
    title: finalTitle,
    savedAt: Date.now(),
    status: 'extracted',
    extractionMethod: 'pasted',
    extractionQuality: 'full',
    pastedText: text,
    contentHtml: body.map((b) => `<p>${escapeHtml(b.text)}</p>`).join(''),
    sentences: script.sentences,
    blocks: script.blocks,
    chunks: script.chunks,
    positionSec: 0,
    queueOrder: await nextQueueOrder(),
    voice: settings.voice,
    ttsProvider: settings.provider,
  });
  void kick();
  return id;
}

/**
 * "Paste the full text" (SPEC §4): replace a partial/failed article's content in place, keeping its
 * id, queue position, art and URL. Discards audio; listening position resets.
 */
export async function replaceWithText(id: string, text: string, title?: string): Promise<void> {
  const a = await db.articles.get(id);
  if (!a) return;
  cancelled.add(id);
  const { finalTitle, body, script } = textScript(text, title || a.title);
  await clearRender(a);
  await db.articles.update(id, {
    source: 'text',
    title: finalTitle,
    status: 'extracted',
    extractionQuality: 'full',
    extractionMethod: 'pasted',
    pastedText: text,
    error: undefined,
    contentHtml: body.map((b) => `<p>${escapeHtml(b.text)}</p>`).join(''),
    sentences: script.sentences,
    blocks: script.blocks,
    chunks: script.chunks,
    positionSec: 0,
    renderProgress: 0,
    durationSec: undefined,
    audioKey: undefined,
    audioBytes: undefined,
  });
  void kick();
}

async function clearRender(a: Article) {
  await db.renderedChunks.where('articleId').equals(a.id).delete();
  if (a.audioKey) await deleteAudio(a.audioKey);
}

/** Hard delete: row, audio, rendered chunks, and art nothing else uses. */
export async function purgeArticle(id: string): Promise<void> {
  cancelled.add(id);
  const a = await db.articles.get(id);
  if (!a) return;
  await db.transaction('rw', db.articles, db.renderedChunks, async () => {
    await db.articles.delete(id);
    await db.renderedChunks.where('articleId').equals(id).delete();
  });
  if (a.audioKey) await deleteAudio(a.audioKey);
  await purgeArt(a);
}

export async function retryArticle(id: string): Promise<void> {
  const a = await db.articles.get(id);
  if (!a) return;
  const status = a.chunks?.length ? 'extracted' : isOnline() ? 'fetching' : 'waiting';
  await db.articles.update(id, { status, error: undefined });
  void kick();
}

/** Re-render with the current voice (e.g. after changing voice or quality). Keeps text and position. */
export async function rerenderArticle(id: string): Promise<void> {
  const a = await db.articles.get(id);
  if (!a?.chunks?.length) return;
  cancelled.add(id);
  const settings = await getSettings();
  await clearRender(a);
  await db.articles.update(id, {
    status: 'extracted',
    renderProgress: 0,
    audioKey: undefined,
    audioBytes: undefined,
    voice: settings.voice,
    ttsProvider: settings.provider,
    error: undefined,
  });
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
  const online = isOnline();
  if (online) {
    // Saved while offline: start fetching now (SPEC §11).
    await db.articles.where('status').equals('waiting').modify({ status: 'fetching' });
  }
  const all = (await db.articles.orderBy('queueOrder').toArray()).filter((a) => !a.deletedAt);
  // Fetch first (cheap, and it gives titles), then render one at a time in queue order.
  const next =
    all.find((a) => a.status === 'fetching' && online) ??
    all.find((a) => a.status === 'rendering' && !a.archivedAt) ??
    all.find((a) => a.status === 'extracted' && !a.archivedAt);
  if (!next) return false;
  cancelled.delete(next.id);

  try {
    if (next.status === 'fetching') await extract(next);
    else await render(next);
  } catch (err) {
    // Engine trouble isn't this article's fault: leave it queued and stop until the next kick.
    if (err instanceof EngineError) return false;
    const message = err instanceof Error ? err.message : String(err);
    if (!(await db.articles.get(next.id))) return true;
    // Offline mid-fetch: wait for the connection rather than failing.
    if (next.status === 'fetching' && !isOnline()) await db.articles.update(next.id, { status: 'waiting' });
    else await db.articles.update(next.id, { status: 'failed', error: message });
  }
  return true;
}

async function extract(a: Article) {
  const settings = await getSettings();
  const { html, finalUrl } = await fetchHtml(a.url, settings);
  const x = parseArticle(html, finalUrl);
  const script = buildScript(withIntro(htmlToBlocks(x.contentHtml), x));
  if (!script.chunks.length) throw new Error('Extracted article has no readable text.');
  const patch: Partial<Article> = {
    status: 'extracted',
    title: x.title,
    byline: x.byline,
    siteName: x.siteName,
    domain: domainOf(finalUrl) ?? a.domain,
    imageUrl: x.imageUrl,
    iconUrl: x.iconUrl,
    canonicalUrl: x.canonicalUrl,
    contentHtml: x.contentHtml,
    extractionMethod: x.method,
    extractionQuality: x.quality,
    sentences: script.sentences,
    blocks: script.blocks,
    chunks: script.chunks,
  };
  await db.articles.update(a.id, patch);
  await fetchArtwork({ ...a, ...patch });
}

/** Load (downloading if needed) the on-device voice model, tracking progress in Settings.voiceModel. */
export async function ensureVoiceModel(quality?: VoiceQuality) {
  const settings = await getSettings();
  const q = quality ?? settings.voiceQuality;
  const prev = settings.voiceModel;
  if (prev.status !== 'ready' || prev.quality !== q) {
    await updateSettings({ voiceModel: { status: 'downloading', quality: q, bytes: prev.quality === q ? prev.bytes : 0, totalBytes: prev.totalBytes } });
  }
  let lastWrite = 0;
  const { engine, ready } = getSharedEngine(settings.engine, q, {
    onStatus: (message) => setEngineState({ phase: 'loading', message }),
    onProgress: (file, loaded, total) => {
      setEngineState({ phase: 'loading', message: `Loading ${file.split('/').pop()}`, loaded, total });
      // The model file dominates; ignore the small config/voice files.
      if (total > 20e6 && Date.now() - lastWrite > 500) {
        lastWrite = Date.now();
        void updateSettings({ voiceModel: { status: 'downloading', quality: q, bytes: loaded, totalBytes: total } });
      }
    },
  });
  if (engineState.phase !== 'ready') setEngineState({ phase: 'loading', message: 'Loading voice model…' });
  try {
    const info = await ready;
    setEngineState({ phase: 'ready', device: info.device, dtype: info.dtype, fallbackReason: info.fallbackReason });
    const s = await getSettings();
    await updateSettings({ voiceModel: { status: 'ready', quality: q, bytes: s.voiceModel.totalBytes, totalBytes: s.voiceModel.totalBytes } });
    return engine;
  } catch (err) {
    setEngineState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    await updateSettings({ voiceModel: { status: 'error', quality: q } });
    throw err;
  }
}

async function render(a: Article) {
  await db.articles.update(a.id, { status: 'rendering', renderProgress: a.renderProgress ?? 0 });
  let engine;
  try {
    engine = await ensureVoiceModel();
  } catch (err) {
    // Keep the article queued; the problem is the engine, not this article.
    await db.articles.update(a.id, { status: 'extracted' });
    throw new EngineError(err instanceof Error ? err.message : String(err));
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

let started = false;
export function startRunner(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => void kick());
  void kick();
}
