import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../app/data';
import { fitList, MAX_NOTE } from '../app/share';
import { copyLink, sendLink } from '../app/sendLink';
import { back, showSnack } from '../app/ui';
import { updateSettings } from '../db';
import { plural } from '../format';
import { CARD_H, CARD_W, canvasToPng, drawCard, loadCardFonts } from '../share/card';
import { cardSpec } from '../share/cardSpec';
import { cardFileName, headline, listArticles, listSignature, MAX_NAME, rangeCounts, RANGE_LABEL, type ShareRange } from '../share/lists';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { toItem } from './listSheets';

const RANGES: ShareRange[] = ['week', 'all'];
const HINT: Record<ShareRange, string> = { week: 'Articles you’ve loved since Monday.', all: 'Everything you’ve loved.' };
/** Typing settles this long before the card is turned into a PNG. */
const SETTLE_MS = 150;

/**
 * Share what you've loved (SPEC §4 "Sharing a reading list"): pick This week or All time, add a name and a
 * note, see the card, then Share. The list travels as a `#list=` link (the same as Share as list) with the
 * card attached as an image where the device can share files. Nothing is uploaded.
 */
export function ShareSavedSheet() {
  const { articles, settings } = useAppData();
  const counts = useMemo(() => rangeCounts(articles), [articles]);
  const [range, setRange] = useState<ShareRange>(counts.week ? 'week' : 'all');
  const [name, setName] = useState(settings.shareName ?? '');
  const [note, setNote] = useState('');
  // What the quiet buttons just did, shown in place of their label for a moment.
  const [flash, setFlash] = useState<'copied' | 'copy-failed' | 'saved' | ''>('');
  // undefined: the image is still being made. null: it couldn't be, so Share sends the link alone.
  const [png, setPng] = useState<File | null | undefined>(undefined);
  const [fit, setFit] = useState<{ key: string; url: string; kept: number; dropped: number; tooLong: boolean } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const count = counts[range];

  const title = headline(name.trim().slice(0, MAX_NAME), range);
  const line = note.trim();
  const list = useMemo(() => listArticles(articles, range), [articles, range]);
  // `articles` changes whenever anything is playing or rendering; the link and the card depend on what they show, not on that.
  const key = `${title}\n${line}\n${listSignature(list)}`;

  // The link: as many of the newest loved as fit in one (SPEC §4), so a long list is trimmed rather than cut off by an app.
  useEffect(() => {
    let live = true;
    if (!list.length) return setFit(null);
    void fitList(location.origin, { name: title, note: line, items: list.map(toItem) }).then((f) => live && setFit({ key, url: f.url, kept: f.list.items.length, dropped: f.dropped, tooLong: f.tooLong }));
    return () => {
      live = false;
    };
  }, [key]);

  const ready = fit?.key === key ? fit : null;
  const kept = ready ? list.slice(0, ready.kept) : [];
  // The card shows what the link holds, so it redraws when any of those articles' title, tint, art or length changes, not just which ones they are.
  const cardKey = ready ? `${range}\n${title}\n${listSignature(kept)}` : '';

  useEffect(() => {
    const el = canvas.current;
    if (!cardKey || !el) return;
    let live = true;
    setPng(undefined);
    void (async () => {
      const spec = await cardSpec(kept, title, range);
      await loadCardFonts(`${title} ${spec.items.map((i) => i.title).join(' ')}`);
      if (!live) return;
      drawCard(el.getContext('2d')!, spec);
      // The image is made ahead of the tap: the share sheet has to open straight from it.
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      if (!live) return;
      try {
        const blob = await canvasToPng(el);
        if (live) setPng(new File([blob], cardFileName(title), { type: 'image/png' }));
      } catch {
        if (live) setPng(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [cardKey]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(''), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  /** Remember the name for the next list. */
  const remember = () => {
    const n = name.trim().slice(0, MAX_NAME);
    if (n !== (settings.shareName ?? '')) void updateSettings({ shareName: n });
  };

  const canShare = !!ready && png !== undefined;
  const share = async () => {
    if (!ready || png === undefined) return;
    remember();
    // Only the link goes with the image (see sendLink). Closing the share sheet isn't an error; stay here so they can try again.
    const outcome = await sendLink(ready.url, png ?? undefined);
    if (outcome === 'cancelled') return;
    if (outcome === 'failed') return showSnack({ text: 'Couldn’t share or copy the link' });
    back();
    showSnack({
      text: [outcome === 'copied' ? 'Link copied' : 'List shared', ready.dropped ? `The ${ready.kept} most recently loved were included` : '', ready.tooLong ? 'It’s a long link; some apps may cut it off' : ''].filter(Boolean).join('. '),
    });
  };

  const copy = async () => {
    if (!ready) return;
    remember();
    setFlash((await copyLink(ready.url)) ? 'copied' : 'copy-failed');
  };

  const saveImage = () => {
    if (!png) return;
    remember();
    const url = URL.createObjectURL(png);
    const a = document.createElement('a');
    a.href = url;
    a.download = png.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setFlash('saved');
  };

  return (
    <Sheet label="Share loved articles">
      <div className="seg" role="radiogroup" aria-label="Which articles">
        {RANGES.map((r) => (
          <button key={r} role="radio" aria-checked={range === r} disabled={!counts[r]} onClick={() => setRange(r)}>
            {RANGE_LABEL[r]}
            <span className="seg-n tabular">{counts[r]}</span>
          </button>
        ))}
      </div>
      <p className="hint share-hint" aria-live="polite">
        {HINT[range]}
      </p>

      <canvas ref={canvas} className="card-preview" width={CARD_W} height={CARD_H} role="img" aria-label={`Preview of the image you’ll share: ${title}, ${plural(ready?.kept ?? count, 'article')}`} />

      {ready && (ready.dropped > 0 || ready.tooLong) && (
        <p className="status-note" role="status">
          <Icon name="warn" size={18} />
          {ready.dropped > 0
            ? `Only the ${ready.kept} most recently loved fit in one link. The other ${ready.dropped} aren’t included.`
            : 'This article makes a long link; some apps may cut it off.'}
        </p>
      )}

      <div className="field">
        <label htmlFor="share-name">Your name (optional)</label>
        <input id="share-name" className="input" type="text" maxLength={MAX_NAME} placeholder="Shown in the headline" value={name} onChange={(e) => setName(e.target.value)} onBlur={remember} autoComplete="given-name" enterKeyHint="next" />
      </div>
      <div className="field">
        <label htmlFor="share-note">A note (optional)</label>
        <input id="share-note" className="input" type="text" maxLength={MAX_NOTE} placeholder="One line about why these" value={note} onChange={(e) => setNote(e.target.value)} enterKeyHint="done" />
      </div>

      <button className="btn primary block" disabled={!canShare} onClick={() => void share()}>
        <Icon name="share" size={20} />
        Share
      </button>
      <div className="share-quiet" aria-live="polite">
        <button className="text-btn" disabled={!ready} onClick={() => void copy()}>
          {flash === 'copied' ? 'Link copied' : flash === 'copy-failed' ? 'Couldn’t copy' : 'Copy link'}
        </button>
        <button className="text-btn" disabled={!png} onClick={saveImage}>
          {flash === 'saved' ? 'Image saved' : 'Save image'}
        </button>
      </div>
      <p className="hint">Sends the card with one link. Whoever opens the link in Reader can add these articles to their own queue. Nothing is uploaded. It’s a snapshot: hearts you add or remove later don’t change it.</p>
    </Sheet>
  );
}
