import { useEffect, useMemo, useState } from 'react';
import { domainOf, type Article } from '../db';
import { useAppData } from '../app/data';
import { listLink, type ListItem, type ReadingList } from '../app/share';
import { sendLink } from '../app/sendLink';
import { back, showSnack } from '../app/ui';
import { addUrl } from '../pipeline/runner';
import { hasRealTitle } from '../queue/display';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';

// Reading lists (SPEC §4 "Sharing a reading list", DESIGN §14): a snapshot of links sent as one link.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const toItem = (a: Article): ListItem => ({ url: a.url, title: hasRealTitle(a) ? a.title : a.url, ...((a.siteName || a.domain) ? { site: a.siteName || a.domain } : {}) });

// ---------- Share as list (from multi-select) ----------

export function ShareListSheet({ ids, onShared }: { ids: string[]; onShared?: () => void }) {
  const { articles } = useAppData();
  const [name, setName] = useState('');
  const [link, setLink] = useState<{ url: string; tooLong: boolean } | null>(null);
  const chosen = ids.map((id) => articles.find((a) => a.id === id)).filter((a): a is Article => !!a && !a.deletedAt);
  // Only links can travel; pasted text and uploads stay on this phone.
  const links = chosen.filter((a) => a.source === 'url' && !!a.url);
  const skipped = chosen.length - links.length;
  const list: ReadingList = useMemo(() => ({ name, items: links.map(toItem) }), [name, links.map((a) => a.id).join()]);

  useEffect(() => {
    let live = true;
    if (list.items.length) void listLink(location.origin, list).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [list]);

  const uploads = chosen.filter((a) => a.source === 'file').length;
  const kind = uploads === skipped ? 'uploaded file' : uploads ? 'pasted or uploaded article' : 'pasted article';
  const skippedNote = skipped ? `${plural(skipped, kind)} ${skipped === 1 ? 'wasn’t' : 'weren’t'} included` : '';

  const share = async () => {
    if (!link) return;
    const done = (how: string) => {
      back();
      onShared?.();
      showSnack({ text: [how, skippedNote, link.tooLong ? 'It’s a long link; some apps may cut it off' : ''].filter(Boolean).join('. ') });
    };
    // Only the link (see sendLink). Closing the share sheet isn't an error; stay here so they can try again.
    const outcome = await sendLink(link.url);
    if (outcome === 'shared') done('List shared');
    else if (outcome === 'copied') done('Link copied');
    else if (outcome === 'failed') showSnack({ text: 'Couldn’t share or copy the link' });
  };

  return (
    <Sheet label="Share as list">
      <p className="hint" style={{ marginTop: -8 }}>
        Sends one link. Whoever opens it in Reader can add these articles to their own queue. Nothing is uploaded.
      </p>
      <div className="field">
        <label htmlFor="list-name">List name (optional)</label>
        <input id="list-name" className="input" type="text" placeholder="Reading list" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <ul className="list-items" aria-label="Articles in this list">
        {links.map((a) => (
          <li key={a.id}>
            <p className="t">{toItem(a).title}</p>
            {toItem(a).site && <p className="hint">{toItem(a).site}</p>}
          </li>
        ))}
      </ul>
      {(skipped > 0 || link?.tooLong) && (
        <p className="status-note" role="status">
          <Icon name="warn" size={18} />
          {[skipped ? `${skippedNote}: only links can be shared.` : '', link?.tooLong ? 'This list makes a long link; some apps may cut it off. Fewer articles fit better.' : ''].filter(Boolean).join(' ')}
        </p>
      )}
      <button className="btn primary block" disabled={!links.length || !link} onClick={() => void share()}>
        {links.length ? `Share ${plural(links.length, 'article')}` : 'No links to share'}
      </button>
    </Sheet>
  );
}

// ---------- Opening a shared list ----------

export function ReadingListSheet({ list }: { list: ReadingList }) {
  const { articles } = useAppData();
  const have = useMemo(() => new Set(articles.filter((a) => !a.deletedAt).flatMap((a) => [a.url, a.canonicalUrl]).filter(Boolean)), [articles]);
  const [adding, setAdding] = useState(false);
  // Everything new starts checked; links already saved are shown but can't be picked.
  const [picked, setPicked] = useState(() => new Set(list.items.map((x) => x.url).filter((u) => !have.has(u))));
  const fresh = list.items.filter((x) => !have.has(x.url));
  const chosen = fresh.filter((x) => picked.has(x.url));
  const toggle = (url: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const add = async () => {
    setAdding(true);
    const seen = new Set<string>();
    for (const x of chosen) {
      if (seen.has(x.url)) continue;
      seen.add(x.url);
      await addUrl(x.url, x.title !== x.url ? x.title : undefined);
    }
    back();
    showSnack({ text: `${plural(seen.size, 'article')} added to Up next` });
  };

  const all = chosen.length === fresh.length;
  return (
    <Sheet label={list.name || 'Reading list'}>
      <p className="hint" style={{ marginTop: -8 }}>
        A reading list someone shared · {plural(list.items.length, 'article')}
        {fresh.length < list.items.length && ` · ${list.items.length - fresh.length} already in your queue`}
      </p>
      {list.note && <p className="list-note">{list.note}</p>}
      {list.items.length ? (
        <ul className="list-items checks" aria-label="Articles">
          {list.items.map((x, i) => {
            const dup = have.has(x.url);
            const id = `list-item-${i}`;
            return (
              <li key={`${x.url}${i}`} className={dup ? 'dup' : undefined}>
                <input id={id} type="checkbox" className="row-check" checked={!dup && picked.has(x.url)} disabled={dup} onChange={() => toggle(x.url)} />
                <label htmlFor={id}>
                  <span className="t">{x.title}</span>
                  <span className="hint">{[x.site ?? domainOf(x.url), dup && 'Already in your queue'].filter(Boolean).join(' · ')}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">This list is empty.</p>
      )}
      <button className="btn primary block" disabled={!chosen.length || adding} onClick={() => void add()}>
        {!fresh.length ? 'All already in your queue' : all ? 'Add all to Up next' : chosen.length ? `Add ${chosen.length} to Up next` : 'Nothing selected'}
      </button>
    </Sheet>
  );
}
