import Dexie, { type Table } from 'dexie';

export type ArticleStatus = 'fetching' | 'extracted' | 'rendering' | 'ready' | 'partial' | 'failed';

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

export interface Article {
  id: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  byline?: string;
  siteName?: string;
  imageUrl?: string;
  savedAt: number;
  status: ArticleStatus;
  error?: string;
  extractionMethod?: string;
  contentHtml?: string;
  /** Raw text for paste-text articles; skips extraction. */
  pastedText?: string;
  sentences: Sentence[];
  chunks?: Chunk[];
  audioKey?: string;
  audioMime?: string;
  audioBytes?: number;
  durationSec?: number;
  renderProgress?: number;
  ttsProvider?: string;
  voice?: string;
  positionSec: number;
  playedAt?: number;
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

export type EnginePref = 'auto' | 'webgpu' | 'wasm';

export interface Settings {
  id: 'app';
  proxyUrl: string;
  proxySecret: string;
  provider: string;
  voice: string;
  engine: EnginePref;
  speed: number;
  skipSeconds: number;
  autoAdvance: boolean;
  keepPlayed: 'delete' | 'archive';
  lastPlayingArticleId?: string;
  persistRequested?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  proxyUrl: import.meta.env.VITE_PROXY_URL ?? '/api',
  proxySecret: import.meta.env.VITE_PROXY_SECRET ?? '',
  provider: 'kokoro',
  voice: 'af_heart',
  engine: 'auto',
  speed: 1,
  skipSeconds: 15,
  autoAdvance: false,
  keepPlayed: 'archive',
};

class ReaderDb extends Dexie {
  articles!: Table<Article, string>;
  renderedChunks!: Table<RenderedChunk, [string, number]>;
  audio!: Table<AudioBlobRow, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('reader');
    this.version(1).stores({
      articles: 'id, status, queueOrder, savedAt',
      renderedChunks: '[articleId+i], articleId',
      audio: 'key',
      settings: 'id',
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

export async function nextQueueOrder(): Promise<number> {
  const last = await db.articles.orderBy('queueOrder').last();
  return (last?.queueOrder ?? 0) + 1;
}
