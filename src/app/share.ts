// SPEC §4 "Share target": classify what another app shared, and read invite / add links.

export type Shared = { kind: 'link'; url: string; title?: string } | { kind: 'text'; text: string; title?: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const SHORT_TEXT = 300;

/** Trim punctuation a sentence leaves stuck to the end of a URL. */
const clean = (u: string) => u.replace(/[).,;:!?\]}»”’]+$/, '');

export function classifyShare(p: { title?: string | null; text?: string | null; url?: string | null }): Shared | null {
  const title = p.title?.trim() || undefined;
  const text = p.text?.trim() ?? '';
  if (p.url?.trim()) return { kind: 'link', url: p.url.trim(), title };
  const urls = text.match(URL_RE) ?? [];
  // Many Android apps send "Headline https://…" in `text`.
  if (urls.length === 1 && (text === urls[0] || text.length < SHORT_TEXT)) {
    const lead = text.replace(urls[0], '').trim().replace(/[\s:–—-]+$/, '');
    return { kind: 'link', url: clean(urls[0]), title: title ?? (lead || undefined) };
  }
  if (!text) return null;
  return { kind: 'text', text, title };
}

/** `#invite=<secret>`, `#add=<url>` (the iPhone Shortcut route), and `#list=<encoded>` (a shared reading list). */
export function readHash(hash: string): { invite?: string; add?: string; list?: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { invite: params.get('invite') ?? undefined, add: params.get('add') ?? undefined, list: params.get('list') ?? undefined };
}

// ---- Reading lists (SPEC §4 "Sharing a reading list"): a snapshot of links in the URL fragment ----
// `#list=<base64url(deflate-raw(JSON))>`. Nothing goes to a server; the fragment never leaves the browser.

export interface ListItem {
  url: string;
  title: string;
  site?: string;
}

export interface ReadingList {
  name?: string;
  items: ListItem[];
}

/** Links longer than this may be cut off by some apps; the share sheet warns. */
export const LIST_LINK_LIMIT = 2000;
const MAX_ITEMS = 500;
const MAX_TEXT = 300;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 4000;
const text = (t: unknown) => (typeof t === 'string' ? t.trim().slice(0, MAX_TEXT) : '');

export async function encodeList(list: ReadingList): Promise<string> {
  const json = JSON.stringify({
    ...(list.name?.trim() ? { name: list.name.trim() } : {}),
    items: list.items.map((x) => ({ url: x.url, title: x.title, ...(x.site ? { site: x.site } : {}) })),
  });
  return toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

/** The list in a `#list=` value, or null if it's damaged or not a list. Drops items that aren't web links. */
export async function decodeList(encoded: string): Promise<ReadingList | null> {
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw')));
    const data = JSON.parse(json) as { name?: unknown; items?: unknown };
    if (!data || !Array.isArray(data.items)) return null;
    const items = data.items
      .filter((x): x is { url: string; title?: unknown; site?: unknown } => !!x && isHttp((x as { url?: unknown }).url))
      .slice(0, MAX_ITEMS)
      .map((x) => ({ url: x.url, title: text(x.title) || x.url, ...(text(x.site) ? { site: text(x.site) } : {}) }));
    const name = text(data.name);
    return { ...(name ? { name } : {}), items };
  } catch {
    return null;
  }
}

/** The link that opens `list` in the app at `origin`. */
export async function listLink(origin: string, list: ReadingList): Promise<{ url: string; tooLong: boolean }> {
  const url = `${origin}/#list=${await encodeList(list)}`;
  return { url, tooLong: url.length > LIST_LINK_LIMIT };
}
