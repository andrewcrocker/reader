import { useEffect, useRef } from 'react';
import { getSettings, updateSettings } from './db';
import { AppDataProvider, useAppData } from './app/data';
import { classifyShare, readHash, type Shared } from './app/share';
import { getUi, openNowPlaying, openSheet, setNewId, showSnack, useUi, useWide } from './app/ui';
import { markAllSeen, startFeedChecks } from './feeds/store';
import { addUrl, kick, startRunner } from './pipeline/runner';
import { acceptInvite, checkInvite } from './app/invite';
import { InviteNeeded } from './screens/InviteNeeded';
import { moveToTop, purgeDeleted } from './queue/actions';
import { PlayerProvider, usePlayer } from './player/PlayerProvider';
import { FirstRun } from './screens/FirstRun';
import { NowPlaying } from './screens/NowPlaying';
import { Archive, Queue } from './screens/Queue';
import { Settings } from './screens/Settings';
import { AddSheet, ExplainSheet, SpeedSheet } from './screens/sheets';
import { Manage } from './screens/Manage';
import { Subscriptions } from './screens/Subscriptions';
import { Spike } from './pages/Spike';

export function App() {
  // The spike is a dev tool with its own plain page; everything else is the app.
  if (location.pathname.replace(/\/$/, '') === '/spike') return <Spike />;
  return (
    <AppDataProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </AppDataProvider>
  );
}

/** What arrived with this launch: a share (SPEC §4), `#add=<url>`, or `#invite=<secret>` (§10a). */
function incoming(): Shared | null {
  const { invite, add } = readHash(location.hash);
  if (invite) void acceptInvite(invite).then(() => (void checkInvite(), kick()));
  else void checkInvite();
  let shared: Shared | null = null;
  if (location.pathname === '/share') {
    const q = new URLSearchParams(location.search);
    shared = classifyShare({ title: q.get('title'), text: q.get('text'), url: q.get('url') });
  } else if (add) shared = { kind: 'link', url: add };
  // Keep the secret and the share out of history and the address bar.
  if (invite || add || location.pathname === '/share') history.replaceState(null, '', '/');
  return shared;
}

/** Read before the first render, so opening an invite link doesn't flash the invite screen. */
const launchInvite = readHash(location.hash).invite;

let booting: Promise<string | undefined> | null = null;
function boot(): Promise<string | undefined> {
  booting ??= (async () => {
    const shared = incoming();
    const s = await getSettings();
    if (!s.persistRequested) {
      // §11a: ask once on first launch; Chrome usually grants this to installed PWAs.
      await navigator.storage?.persist?.().catch(() => false);
      await updateSettings({ persistRequested: true });
    }
    // Rows left soft-deleted when the app closed mid-undo.
    await purgeDeleted();
    startRunner();
    // Pull-only: looks for new posts now and each time the app comes back to the front (SPEC §4).
    startFeedChecks();
    if (shared?.kind === 'text') openSheet({ kind: 'add', tab: 'text', text: shared.text, title: shared.title, shared: true });
    if (shared?.kind === 'link') return addUrl(shared.url, shared.title);
  })();
  return booting;
}

let arrivalShown = false;

function Shell() {
  const { loaded, settings } = useAppData();
  const ui = useUi();
  const wide = useWide();
  const player = usePlayer();

  useEffect(() => {
    void boot().then((id) => {
      if (!id || arrivalShown) return;
      arrivalShown = true;
      // DESIGN §6: highlight the new row with a snackbar to move it up or play it.
      setNewId(id);
      showSnack({
        text: 'Saved to your queue',
        actions: [
          { label: 'Move to top', run: () => moveToTop([id]).then(() => {}) },
          {
            label: 'Play now',
            run: async () => {
              await moveToTop([id]);
              player.play(id);
              openNowPlaying();
            },
          },
        ],
      });
    });
  }, [player.play]);

  // New posts count as seen once the user leaves Subscriptions (or the app goes to the background
  // while it's open). Marking them on arrival would clear the markers before they could be read.
  const lastTab = useRef(ui.tab);
  useEffect(() => {
    if (lastTab.current === 'subscriptions' && ui.tab !== 'subscriptions') void markAllSeen();
    lastTab.current = ui.tab;
  }, [ui.tab]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && getUi().tab === 'subscriptions') void markAllSeen();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  if (!loaded) return <div className="app" />;
  // A just-opened invite counts until it's saved; after that, a 401 from the Worker shows the screen again.
  const fresh = !!launchInvite && launchInvite !== settings.proxySecret;
  if (!fresh && (!settings.proxySecret || settings.inviteRejected)) return <InviteNeeded rejected={!!settings.proxySecret} />;
  if (!settings.onboarded) {
    return (
      <div className="app">
        <FirstRun />
      </div>
    );
  }
  const sheet = ui.sheet;
  const sheets = (
    <>
      {sheet?.kind === 'add' && <AddSheet key={`${sheet.tab}${sheet.replaceId ?? ''}${sheet.text?.length ?? 0}`} sheet={sheet} />}
      {sheet?.kind === 'speed' && <SpeedSheet />}
      {sheet?.kind === 'explain' && <ExplainSheet id={sheet.id} />}
    </>
  );
  // Settings and Your subscriptions are their own screens; otherwise the tab bar picks the list. Up next is the home view.
  const screen = ui.settings ? <Settings /> : ui.manage ? <Manage /> : ui.tab === 'subscriptions' ? <Subscriptions /> : ui.tab === 'archive' ? <Archive /> : <Queue />;
  if (wide) {
    // Wide screens: the queue, Subscriptions, Archive, Settings or Your subscriptions on the left, Now Playing always open on the right.
    return (
      <div className="app wide">
        <div className="pane-left">{screen}</div>
        <div className="pane-right">{player.current ? <NowPlaying embedded /> : <NothingPlaying />}</div>
        {sheets}
      </div>
    );
  }
  return (
    <div className="app">
      {screen}
      {ui.nowPlaying && <NowPlaying />}
      {sheets}
    </div>
  );
}

function NothingPlaying() {
  return (
    <div className="np-empty">
      <h2>Nothing playing</h2>
      <p>Tap an article in your queue to play it.</p>
    </div>
  );
}

