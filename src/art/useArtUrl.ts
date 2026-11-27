import { useEffect, useState } from 'react';
import { db } from '../db';

// Kept apart from art.ts so the service worker can fetch artwork without pulling in React.

// ---- Object URLs for stored art, shared and ref-counted across components ----

const urls = new Map<string, { url: string; refs: number }>();

export function useArtUrl(key: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (key ? urls.get(key)?.url : undefined));
  useEffect(() => {
    if (!key) {
      setUrl(undefined);
      return;
    }
    let live = true;
    const cached = urls.get(key);
    if (cached) {
      cached.refs++;
      setUrl(cached.url);
    } else {
      void db.art.get(key).then((row) => {
        if (!live || !row) return;
        const existing = urls.get(key);
        if (existing) {
          existing.refs++;
          setUrl(existing.url);
        } else {
          const u = URL.createObjectURL(row.blob);
          urls.set(key, { url: u, refs: 1 });
          setUrl(u);
        }
      });
    }
    return () => {
      live = false;
      const entry = urls.get(key);
      if (!entry) return;
      entry.refs--;
      if (entry.refs <= 0) {
        // Keep briefly so remounts (row -> mini player -> Now Playing) don't flash.
        setTimeout(() => {
          const e = urls.get(key);
          if (e && e.refs <= 0) {
            URL.revokeObjectURL(e.url);
            urls.delete(key);
          }
        }, 5000);
      }
    };
  }, [key]);
  return url;
}
