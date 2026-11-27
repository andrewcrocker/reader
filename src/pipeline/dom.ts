// The page has a native DOMParser; a service worker doesn't. The service worker registers
// linkedom's here (src/sw.ts), so extraction and text prep run the same code in both places.

type ParseHtml = (html: string) => Document;

let fallback: ParseHtml | null = null;

export function setHtmlParser(fn: ParseHtml): void {
  fallback = fn;
}

export function parseHtml(html: string): Document {
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(html, 'text/html');
  if (!fallback) throw new Error('No HTML parser available');
  return fallback(html);
}

/** An attribute URL made absolute against `base` (linkedom doesn't resolve `.href`). */
export function absUrl(raw: string | null | undefined, base: string): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return new URL(raw.trim(), base).toString();
  } catch {
    return undefined;
  }
}
