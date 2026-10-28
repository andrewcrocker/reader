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

/** `#invite=<secret>` and `#add=<url>` (the iPhone Shortcut route). */
export function readHash(hash: string): { invite?: string; add?: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { invite: params.get('invite') ?? undefined, add: params.get('add') ?? undefined };
}
