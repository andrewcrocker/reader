import { useEffect, useState } from 'react';
import { useAppData } from '../app/data';
import { back, showSnack } from '../app/ui';
import { FeedError } from '../feeds/discover';
import { normalizeAddress } from '../feeds/parse';
import { subscribe } from '../feeds/store';
import { ExtractError } from '../pipeline/extract';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';

/** The first thing on the clipboard that could be an address: a link, or a bare domain like `vitalik.eth.limo`. */
async function readClipboardAddress(): Promise<string | undefined> {
  const text = (await navigator.clipboard.readText()).trim();
  const candidate = text.match(/https?:\/\/\S+/)?.[0] ?? (/^\S+\.\S+$/.test(text) ? text : undefined);
  return candidate && normalizeAddress(candidate) ? candidate : undefined;
}

/**
 * Add a subscription (DESIGN §10): the Add sheet from Up next, for a blog instead of an article. Paste
 * the blog's address or its feed's, or type it. The posts already on the blog count as seen.
 */
export function SubscribeSheet() {
  const { online } = useAppData();
  const [clip, setClip] = useState<{ state: 'unknown' | 'none' | 'url'; url?: string }>({ state: 'unknown' });
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Preview the clipboard only if we may read it silently; otherwise reading waits for the tap.
  useEffect(() => {
    void navigator.permissions
      ?.query({ name: 'clipboard-read' as PermissionName })
      .then(async (p) => {
        if (p.state !== 'granted') return;
        const url = await readClipboardAddress();
        setClip(url ? { state: 'url', url } : { state: 'none' });
      })
      .catch(() => {});
  }, []);

  const save = async (address: string) => {
    if (busy || !address.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const feed = await subscribe(address);
      back();
      showSnack({ text: `Subscribed to ${feed.title}` });
    } catch (e) {
      // The address stays in the field so it can be fixed.
      setTyped((t) => t || address);
      setError(e instanceof FeedError || e instanceof ExtractError ? e.message : 'Couldn’t subscribe. Try again.');
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const url = clip.url ?? (await readClipboardAddress());
      if (url) return void save(url);
      setClip({ state: 'none' });
    } catch {
      setClip({ state: 'none' });
    }
  };

  return (
    <Sheet label="Add a subscription">
      <button className="paste-btn" disabled={clip.state === 'none' || busy || !online} onClick={() => void paste()}>
        <Icon name="clipboard" size={26} />
        <span style={{ minWidth: 0 }}>
          <span className="l1">{busy ? 'Looking…' : 'Paste address'}</span>
          <span className="l2">{clip.state === 'url' ? clip.url!.replace(/^https?:\/\/(www\.)?/, '') : clip.state === 'none' ? 'No address on your clipboard' : 'From your clipboard'}</span>
        </span>
      </button>
      <div className="divider-label">or type it</div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void save(typed);
        }}
      >
        <label htmlFor="feed-input">Blog address</label>
        <div className="input-row">
          <input
            id="feed-input"
            className="input"
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          <button className="btn primary" type="submit" disabled={busy || !typed.trim() || !online}>
            {busy ? 'Looking…' : 'Subscribe'}
          </button>
        </div>
      </form>
      {!online && (
        <p className="status-note" role="status">
          <Icon name="cloud-off" size={18} />
          You’re offline. Try again when you’re back online.
        </p>
      )}
      {error && (
        <p className="status-note" role="alert">
          <Icon name="warn" size={18} />
          {error}
        </p>
      )}
      <p className="hint">Paste a blog’s address, or its feed address. New posts show up in Subscriptions, and you pick which ones to add.</p>
    </Sheet>
  );
}
