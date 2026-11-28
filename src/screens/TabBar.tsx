import { useAppData } from '../app/data';
import { setTab, useUi, type Tab } from '../app/ui';
import { Icon, type IconName } from '../ui/Icon';
import { Snackbar } from '../ui/Snackbar';
import { MiniPlayer } from './MiniPlayer';

const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'subscriptions', label: 'Subscriptions', icon: 'rss' },
  { tab: 'queue', label: 'Up next', icon: 'queue' },
  { tab: 'saved', label: 'Saved', icon: 'heart' },
];

/**
 * DESIGN "Navigation": Subscriptions, Up next, Saved. The only indicator is one small accent dot
 * on Subscriptions when there are new posts. It's a shape, and the tab's name says it too.
 */
export function TabBar() {
  const { tab: current } = useUi();
  const { hasNewPosts } = useAppData();
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map(({ tab, label, icon }) => {
        const dot = tab === 'subscriptions' && hasNewPosts;
        return (
          <button key={tab} className="tab" aria-current={tab === current ? 'page' : undefined} aria-label={dot ? `${label}, new posts` : label} onClick={() => setTab(tab)}>
            <span className="tab-ico">
              <Icon name={icon} />
              {dot && <span className="tab-dot" aria-hidden="true" />}
            </span>
            <span className="tab-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** The foot of a list screen: snackbar, then the mini player, then the tab bar. */
export function Dock() {
  return (
    <div className="dock has-tabs">
      <Snackbar />
      <MiniPlayer />
      <TabBar />
    </div>
  );
}
