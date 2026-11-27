import Dexie, { type Table } from 'dexie';

/** SPEC §9. `partial` is no longer a status: see `extractionQuality`. */
export type ArticleStatus = 'waiting' | 'fetching' | 'extracted' | 'rendering' | 'ready' | 'failed';

export interface Sentence {
  i: number;
  text: string;
  start?: number;
  end?: number;
}

/** One TTS request: 1–3 consecutive sentences from the same block. */
export interface Chunk {
  i: number;
  text: string;
  /** Index of the first sentence in this chunk and how many it covers. */
  sentenceStart: number;
  sentenceCount: number;
  /** Silence appended after this chunk, in seconds. */
  pauseAfter: number;
}

/** Display structure for the lyrics view: which sentences belong to which heading/paragraph. */
export interface LyricBlock {
  kind: 'intro' | 'heading' | 'para';
  first: number;
  count: number;
}

export interface Article {
  id: string;
  source: 'url' | 'text';
  /** Empty for pasted text. */
  url: string;
  canonicalUrl?: string;
  /** The URL until a real title arrives. */
  title: string;
  byline?: string;
  siteName?: string;
  domain?: string;
  savedAt: number;
  status: ArticleStatus;
  extractionQuality?: 'full' | 'partial';
  /** One-line, user-facing reason when failed. */
  error?: string;
  /** What failed: the page/site, our fetch service (proxy) not answering, or making the audio. */
  errorKind?: 'page' | 'service' | 'audio';

  extractionMethod?: string;
  contentHtml?: string;
  /** Raw text for paste-text articles; skips extraction. */
  pastedText?: string;
  sentences: Sentence[];
  blocks?: LyricBlock[];
  chunks?: Chunk[];
  /** Remote art URLs found at extraction; fetched and stored as blobs afterwards. */
  imageUrl?: string;
  iconUrl?: string;
  articleArtKey?: string;
  siteArtKey?: string;
  /** Hex, before per-theme clamping (DESIGN "Article tint"). */
  tintSource?: string;
  audioKey?: string;
  audioMime?: string;
  audioBytes?: number;
  /** At 1.0×. */
  durationSec?: number;
  renderProgress?: number;
  /** Server render job id, once the article's text has been sent to the Worker. */
  serverJob?: string;
  /** Rendering is paused until this time because the server's daily voice budget ran out. */
  busyUntil?: number;
  ttsProvider?: string;
  voice?: string;
  positionSec: number;
  playedAt?: number;
  archivedAt?: number;
  /** When the user loved it: something to revisit or share, apart from archived, which only means done. Unset = not loved. */
  lovedAt?: number;
  /** Soft delete for undo; purged after the snackbar window. */
  deletedAt?: number;
  queueOrder: number;
}

/** Per-chunk PCM saved as it renders, so an interrupted render resumes where it stopped. */
export interface RenderedChunk {
  articleId: string;
  i: number;
  pcm: ArrayBuffer; // Int16 mono
  sampleRate: number;
}

export interface AudioBlobRow {
  key: string;
  blob: Blob;
}

/** Stored artwork, already downscaled. Site art is keyed per domain and shared. */
export interface ArtRow {
  key: string;
  blob: Blob;
  /** Dominant non-neutral color, hex. */
  color?: string;
}

/** A blog the user subscribes to (SPEC §4 "Feed inbox"). Lives on the device like everything else. */
export interface Feed {
  id: string;
  /** The RSS/Atom address we fetch. */
  feedUrl: string;
  /** The blog's home page, if the feed says. */
  siteUrl?: string;
  title: string;
  addedAt: number;
  /** Set after every attempt, good or bad, so a broken feed isn't retried on every launch. */
  lastCheckedAt?: number;
  /** One-line reason the last check failed; cleared by the next good one. */
  lastError?: string;
  /**
   * Where post links are rebased to (an origin), for a blog that moved hosts but still serves its
   * feed from the new one: the feed's own links point at a host that no longer answers. `null`
   * means the links were checked and are kept as they are; unset means not checked yet. Not indexed.
   */
  linkBase?: string | null;
}

/** One post from a feed. `id` is a stable hash of the feed id and the post's guid or link as the feed gave them. */
export interface FeedItem {
  id: string;
  feedId: string;
  /** Where the post is read. The feed's link, or that link moved onto the feed's host (see `Feed.linkBase`). */
  link: string;
  title: string;
  publishedAt?: number;
  firstSeenAt: number;
  /** null until the user has looked at it: that is what lights the dot on the Subscriptions tab. */
  seenAt: number | null;
  /** The queue article made from this post, once the user added it. */
  articleId?: string;
}

/** A reading list the user published (spec/SHARING.md). The list itself is a snapshot on the server; this is the receipt. */
export interface SharedList {
  id: string;
  /** The public link. */
  url: string;
  range: 'week' | 'all';
  /** The headline on the card, e.g. "Zach's reading this week". */
  title: string;
  count: number;
  createdAt: number;
}

export type EnginePref = 'auto' | 'webgpu' | 'wasm';
export type VoiceQuality = 'high' | 'standard';
export type EngineKind = 'server' | 'device';

export interface VoiceModelState {
  status: 'none' | 'downloading' | 'ready' | 'error';
  bytes?: number;
  totalBytes?: number;
  quality?: VoiceQuality;
}

export interface Settings {
  id: 'app';
  proxyUrl: string;
  proxySecret: string;
  /** The Worker rejected `proxySecret` (401); the app shows the invite screen until a new invite arrives. */
  inviteRejected?: boolean;
  /** "server" = Kokoro on our Worker's voice host. "device" (on-device Kokoro) has no Settings control; the /spike page still uses that engine. */
  engineKind: EngineKind;
  /** Backend preference for the on-device engine (spike/debug). */
  engine: EnginePref;
  provider: string;
  voice: string;
  voiceQuality: VoiceQuality;
  voiceModel: VoiceModelState;
  speed: number;
  skipSeconds: 10 | 15 | 30;
  autoAdvance: boolean;
  keepPlayed: 'archive' | 'delete';
  lyricsOn: boolean;
  lastPlayingArticleId?: string;
  persistRequested?: boolean;
  /** First run finished (or skipped). */
  onboarded?: boolean;
  /** "Your name" on the share sheet, remembered for the next list. */
  shareName?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  proxyUrl: import.meta.env.VITE_PROXY_URL ?? '/api',
  proxySecret: import.meta.env.VITE_PROXY_SECRET ?? '',
  engineKind: 'server',
  engine: 'auto',
  provider: 'kokoro',
  voice: 'af_heart',
  voiceQuality: 'high',
  voiceModel: { status: 'none' },
  speed: 1,
  skipSeconds: 15,
  autoAdvance: true,
  keepPlayed: 'archive',
  lyricsOn: false,
};

class ReaderDb extends Dexie {
  articles!: Table<Article, string>;
  renderedChunks!: Table<RenderedChunk, [string, number]>;
  audio!: Table<AudioBlobRow, string>;
  art!: Table<ArtRow, string>;
  settings!: Table<Settings, string>;
  feeds!: Table<Feed, string>;
  feedItems!: Table<FeedItem, string>;
  sharedLists!: Table<SharedList, string>;

  constructor() {
    super('reader');
    this.version(1).stores({
      articles: 'id, status, queueOrder, savedAt',
      renderedChunks: '[articleId+i], articleId',
      audio: 'key',
      settings: 'id',
    });
    this.version(2)
      .stores({
        articles: 'id, status, queueOrder, savedAt, domain',
        renderedChunks: '[articleId+i], articleId',
        audio: 'key',
        art: 'key',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        // v1 had `partial` as a status; it's now a quality flag on a normal article (SPEC §9).
        await tx.table('articles').toCollection().modify((a: Record<string, unknown>) => {
          a.source = a.pastedText ? 'text' : 'url';
          if (a.status === 'partial') {
            a.status = a.audioKey ? 'ready' : 'extracted';
            a.extractionQuality = 'partial';
          }
          if (typeof a.url === 'string' && a.url) {
            try {
              a.domain = new URL(a.url).hostname.replace(/^www\./, '');
            } catch {
              /* leave unset */
            }
          }
          if (a.playedAt && !a.archivedAt) a.archivedAt = a.playedAt;
        });
        await tx.table('settings').toCollection().modify((s: Record<string, unknown>) => {
          if (![10, 15, 30].includes(s.skipSeconds as number)) s.skipSeconds = 15;
          // Anyone upgrading from v1 already has a working setup.
          s.onboarded = true;
        });
      });
    this.version(3).upgrade(async (tx) => {
      // Server voices became the default everywhere, and the voice list shrank to three.
      await tx.table('settings').toCollection().modify((s: Record<string, unknown>) => {
        s.engineKind = 'server';
        if (!['af_heart', 'af_bella', 'am_michael'].includes(s.voice as string)) s.voice = 'af_heart';
      });
      await tx.table('articles').toCollection().modify((a: Record<string, unknown>) => {
        if (!a.audioKey && a.voice && !['af_heart', 'af_bella', 'am_michael'].includes(a.voice as string)) a.voice = 'af_heart';
      });
    });
    this.version(4).upgrade(async (tx) => {
      // The on-device choice left Settings; nobody can switch back, so nobody stays on it.
      await tx.table('settings').toCollection().modify((s: Record<string, unknown>) => {
        s.engineKind = 'server';
      });
    });
    // The Subscriptions inbox. `seenAt` is null for unseen posts, which IndexedDB can't index, so unseen is found in memory.
    this.version(5).stores({
      feeds: 'id, feedUrl',
      feedItems: 'id, feedId',
    });
    // Receipts for published reading lists. (Loving adds `lovedAt` to articles without an index, so it needs no version.)
    this.version(6).stores({
      sharedLists: 'id, createdAt',
    });
  }
}

export const db = new ReaderDb();

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'app' });
}

/** End of Up next. */
export async function nextQueueOrder(): Promise<number> {
  const last = await db.articles.orderBy('queueOrder').last();
  return (last?.queueOrder ?? 0) + 1;
}

/** Before the first article. */
export async function firstQueueOrder(): Promise<number> {
  const first = await db.articles.orderBy('queueOrder').first();
  return (first?.queueOrder ?? 1) - 1;
}

export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
