import { db, domainOf, getSettings, type Article } from '../db';
import { fetchArtwork } from '../art/art';
import { buildScript, htmlToBlocks, introBlock, type Block } from './textprep';
import { ExtractError, loadArticle } from './extract';
import { parsePdf } from './pdf';
import { withLock } from './serverSync';

// Fetching and extracting articles, shared by the page's runner and the service worker, so an
// article shared just before the app closes still gets its text (and goes to the voice server).
// One copy works at a time (a lock); the others find nothing left to do.

const isOnline = () => navigator.onLine;

export function withIntro(blocks: Block[], meta: { title?: string; byline?: string; siteName?: string }): Block[] {
  const intro = introBlock(meta);
  return intro ? [intro, ...blocks] : blocks;
}

/** Failed state with a one-line, user-facing reason (DESIGN §9). */
export function failure(err: unknown): Partial<Article> {
  if (err instanceof ExtractError) return { status: 'failed', error: err.message, errorKind: err.kind };
  return { status: 'failed', error: err instanceof Error ? err.message : String(err), errorKind: undefined };
}

async function extract(a: Article): Promise<void> {
  const settings = await getSettings();
  const x = a.source === 'file' ? await loadFile(a) : await loadArticle(a.url, settings);
  // PDFs come back as blocks already; web pages as Readability HTML.
  const blocks = x.blocks ?? htmlToBlocks(x.contentHtml);
  const script = buildScript(withIntro(blocks, x));
  if (!script.chunks.length) throw new ExtractError(x.blocks ? 'We couldn’t find any text in this PDF.' : 'We couldn’t find any article text on this page.', 'page');
  const patch: Partial<Article> = {
    status: 'extracted',
    title: x.title,
    byline: x.byline,
    siteName: x.siteName,
    domain: (x.finalUrl ? domainOf(x.finalUrl) : undefined) ?? a.domain,
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
  if (a.source === 'file') await db.files.delete(a.id);
  await fetchArtwork({ ...a, ...patch });
}

/** An uploaded or shared PDF, waiting in `files` until it's read. */
async function loadFile(a: Article) {
  const row = await db.files.get(a.id);
  if (!row) throw new ExtractError('The file is gone. Add it again.', 'page', true);
  return parsePdf(new Uint8Array(await row.blob.arrayBuffer()), { fileName: row.name });
}

/**
 * Fetches and extracts the next article that needs it. Returns false when there's nothing to fetch
 * (or no connection). Uploaded PDFs need no connection.
 */
export async function fetchStep(cancelled: Set<string> = new Set()): Promise<boolean> {
  return withLock('read-aloud-fetch', async () => {
    const online = isOnline();
    // Saved while offline: start fetching now (SPEC §11).
    if (online) await db.articles.where('status').equals('waiting').modify({ status: 'fetching' });
    const live = (await db.articles.orderBy('queueOrder').toArray()).filter((a) => !a.deletedAt);
    const next = live.find((a) => a.status === 'fetching' && (online || a.source === 'file'));
    if (!next) return false;
    cancelled.delete(next.id);
    try {
      await extract(next);
    } catch (err) {
      if (!(await db.articles.get(next.id))) return true;
      // Offline mid-fetch: wait for the connection rather than failing.
      if (!isOnline() && next.source !== 'file') await db.articles.update(next.id, { status: 'waiting' });
      else await db.articles.update(next.id, failure(err));
    }
    return true;
  });
}
