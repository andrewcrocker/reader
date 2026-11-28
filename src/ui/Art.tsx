import type { Article, Feed } from '../db';
import { initials } from '../art/art';
import { useArtUrl } from '../art/useArtUrl';
import { coverInk, domainColor } from '../theme/color';
import { siteLabel, urlTitle } from '../queue/display';
import { Icon } from './Icon';

type Size = 52 | 48 | 44 | 40 | 36;

/** Background color of the generated cover: the art's own color (unclamped), else a hash of the domain. */
export function coverColor(a: Article): string {
  return a.tintSource ?? domainColor(a.domain);
}

/**
 * Small art slot (rows, mini player, peek). Site art first, then article art, then initials on the
 * source color. Rows with no title yet show a link glyph on `fill`.
 */
export function Art({ article: a, size, placeholder }: { article: Article; size: Size; placeholder?: boolean }) {
  const key = a.siteArtKey ?? a.articleArtKey;
  const url = useArtUrl(placeholder ? undefined : key);
  const cls = `art s${size}`;
  if (placeholder) {
    return (
      <div className={cls} aria-hidden="true">
        <Icon name="link" size={size >= 48 ? 22 : 18} />
      </div>
    );
  }
  if (url) {
    return (
      <div className={cls} aria-hidden="true">
        <img src={url} alt="" />
      </div>
    );
  }
  const bg = coverColor(a);
  const mark = initials(siteLabel(a) ?? a.domain);
  const fs = Math.round(size * (mark.length >= 3 ? 0.3 : mark.length === 2 ? 0.35 : 0.4));
  return (
    <div className={cls} aria-hidden="true" style={{ background: bg, color: coverInk(bg), fontSize: fs }}>
      {mark}
    </div>
  );
}

/** Now Playing cover: article art, else site art, else the generated typographic cover. */
export function Cover({ article: a }: { article: Article }) {
  const url = useArtUrl(a.articleArtKey ?? a.siteArtKey);
  const site = siteLabel(a);
  const title = a.title && a.title !== a.url ? a.title : urlTitle(a.url);
  const label = `Cover: ${title}${site ? `, ${site}` : ''}`;
  if (url) {
    return (
      <div className="cover" role="img" aria-label={label} style={{ padding: 0, background: 'var(--fill)' }}>
        <img src={url} alt="" />
      </div>
    );
  }
  const bg = coverColor(a);
  return (
    <div className="cover" role="img" aria-label={label} style={{ background: bg, color: coverInk(bg) }}>
      <div className="cover-top">
        <span>{site}</span>
        <span>{initials(site ?? a.domain)}</span>
      </div>
      <div>
        <div className="cover-rule" />
        <p className="cover-title">{title}</p>
      </div>
    </div>
  );
}

/**
 * The mark on the art of an article that came from a subscription (DESIGN §1). When the row shows the
 * article's own picture, the mark is the blog's picture, so you can tell whose it is. When the row
 * already shows the blog's own art (its icon, or its initials), the mark is the feed glyph on `accent`:
 * repeating the same picture would say nothing.
 */
export function FeedBadge({ article: a, feed }: { article: Article; feed: Feed }) {
  // Rows show site art first (see `Art`), so the article's own picture is on show only when there is no site art.
  const ownArt = !a.siteArtKey && !!a.articleArtKey;
  const url = useArtUrl(ownArt && feed.artKey ? feed.artKey : undefined);
  return (
    <span className={url ? 'art-badge' : 'art-badge glyph-badge'} role="img" aria-label={`From ${feed.title}`}>
      {url ? <img src={url} alt="" /> : <Icon name="rss" size={13} stroke={2.4} />}
    </span>
  );
}
