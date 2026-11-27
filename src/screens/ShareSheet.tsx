import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppData } from '../app/data';
import { back, showSnack } from '../app/ui';
import { db, updateSettings } from '../db';
import { CARD_H, CARD_W, drawCard, loadCardFonts, renderCardBlob, type CardSpec } from '../share/card';
import { headline, listArticles, MAX_ITEMS, MAX_NAME, MAX_NOTE, plural, rangeCounts, RANGE_LABEL, type ShareRange } from '../share/lists';
import { cardSpec, copyLink, publishList, PublishError, shareLink, type ShareOutcome } from '../share/publish';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';

const RANGES: ShareRange[] = ['week', 'all'];
const HINT: Record<ShareRange, string> = { week: 'Articles you starred in the last 7 days.', all: 'Everything you’ve starred.' };

/** Tells the user how the share went, quietly. */
function announce(outcome: ShareOutcome, url: string) {
  if (outcome === 'shared') return;
  if (outcome === 'copied') return showSnack({ text: 'Link copied. Paste it anywhere.' });
  if (outcome === 'cancelled') {
    return showSnack({
      text: 'Your list is published',
      actions: [{ label: 'Copy link', run: () => copyLink(url).then((r) => showSnack({ text: r === 'copied' ? 'Link copied' : url })) }],
    });
  }
  showSnack({ text: `Your list is published: ${url}` });
}

/**
 * Share a reading list (spec/SHARING.md). Pick "This week" or "All time", add a name and a note, see
 * the card people will see, then publish: the Worker stores a snapshot and the link goes to the share sheet.
 */
export function ShareSheet() {
  const { articles, settings, online } = useAppData();
  const counts = useMemo(() => rangeCounts(articles), [articles]);
  const [range, setRange] = useState<ShareRange>(counts.week ? 'week' : 'all');
  const [name, setName] = useState(settings.shareName ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const count = counts[range];
  const shown = Math.min(count, MAX_ITEMS);

  // The artwork loads when the range changes; the headline redraws as the name is typed.
  const list = useMemo(() => listArticles(articles, range), [articles, range]);
  const key = list.map((a) => a.id).join(',');
  const [base, setBase] = useState<Omit<CardSpec, 'headline'> | null>(null);
  useEffect(() => {
    let live = true;
    void cardSpec(articles, range, '').then(({ headline: _unused, ...rest }) => live && setBase(rest));
    return () => {
      live = false;
    };
    // `key` stands for the articles in the range: `articles` itself changes whenever anything is playing or rendering.
  }, [key, range]);

  const title = headline(name.trim().slice(0, MAX_NAME), range);
  useEffect(() => {
    const el = canvas.current;
    if (!base || !el) return;
    let live = true;
    const spec: CardSpec = { ...base, headline: title };
    void loadCardFonts(`${title} ${base.items.map((i) => i.title).join(' ')}`).then(() => live && drawCard(el.getContext('2d')!, spec));
    return () => {
      live = false;
    };
  }, [base, title]);

  const past = useLiveQuery(() => db.sharedLists.orderBy('createdAt').reverse().limit(3).toArray(), []);

  const publish = async () => {
    if (busy || !count) return;
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ shareName: name.trim().slice(0, MAX_NAME) });
      let png = await renderCardBlob(await cardSpec(articles, range, name));
      // The Worker takes 1 MB. A card with five photos stays well under it, but if one doesn't, send it without the art.
      if (png.size > 900_000) png = await renderCardBlob(await cardSpec(articles, range, name, false));
      const rec = await publishList(articles, range, name, note, png);
      const outcome = await shareLink(rec.url, rec.title);
      back();
      announce(outcome, rec.url);
    } catch (e) {
      setError(e instanceof PublishError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label="Share a list">
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
        {count > MAX_ITEMS ? ` The newest ${MAX_ITEMS} are included.` : ''}
      </p>

      <canvas ref={canvas} className="card-preview" width={CARD_W} height={CARD_H} role="img" aria-label={`Preview of the image people see: ${title}, ${plural(shown, 'article')}`} />

      <div className="field">
        <label htmlFor="share-name">Your name (optional)</label>
        <input id="share-name" className="input" type="text" maxLength={MAX_NAME} placeholder="Shown in the headline" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" enterKeyHint="next" />
      </div>
      <div className="field">
        <label htmlFor="share-note">A note (optional)</label>
        <input id="share-note" className="input" type="text" maxLength={MAX_NOTE} placeholder="One line about why these" value={note} onChange={(e) => setNote(e.target.value)} enterKeyHint="done" />
      </div>

      {error && (
        <p className="status-note error" role="alert">
          <Icon name="warn" size={18} />
          {error}
        </p>
      )}
      <button className="btn primary block" disabled={busy || !count || !online} aria-busy={busy} onClick={() => void publish()}>
        {!online ? <Icon name="cloud-off" size={18} /> : <Icon name="share" size={20} />}
        {busy ? 'Publishing…' : !online ? 'Offline' : 'Share'}
      </button>
      <p className="hint">Anyone with the link can see this list and open its articles. It’s a snapshot: stars you add or remove later don’t change it.</p>

      {!!past?.length && (
        <section aria-labelledby="past-h">
          <h3 className="caps" id="past-h" style={{ margin: '4px 0 6px' }}>
            Shared before
          </h3>
          <ul className="shared-list">
            {past.map((l) => (
              <li key={l.id} className="shared-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="t">{l.title}</p>
                  <p className="m tabular">
                    {new Date(l.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {plural(l.count, 'article')}
                  </p>
                </div>
                <button
                  className="text-btn"
                  aria-label={`Share “${l.title}” again`}
                  onClick={() => {
                    // Close first so a snackbar isn't hidden behind the sheet; sharing stays inside this tap.
                    back();
                    void shareLink(l.url, l.title).then((o) => announce(o, l.url));
                  }}
                >
                  Share again
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}
