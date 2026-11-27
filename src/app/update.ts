import { registerSW } from 'virtual:pwa-register';
import { db } from '../db';

// New versions download in the background; this switches to them without the user doing anything:
// as soon as nothing is playing (a reload mid-article would cut the audio off), or right away if
// the app is hidden. Returning to the app also checks for a new version, since an installed app
// can stay open for days without navigating.

let apply: (() => Promise<void>) | null = null;

const playing = () => {
  const audio = document.querySelector('audio');
  return !!audio && !audio.paused;
};

function tryApply() {
  if (!apply || playing()) return;
  const go = apply;
  apply = null;
  void go();
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    apply = () => updateSW(true);
    tryApply();
  },
  onRegisteredSW(_url, reg) {
    if (reg) void askForRefresh(reg);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg?.update();
      else {
        tryApply();
        if (reg) void handOff(reg);
      }
    });
  },
});

// <audio> pause and ended events don't bubble; listen in the capture phase.
document.addEventListener('pause', tryApply, true);
document.addEventListener('ended', tryApply, true);

// ---- Working while closed (SPEC §11b) ----

type SyncReg = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
  periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void> };
};

/** Something the service worker could finish: text to fetch, articles to send, audio to download. */
async function workLeft(): Promise<boolean> {
  const n = await db.articles
    .filter((a) => !a.deletedAt && !a.archivedAt && (a.status === 'fetching' || a.status === 'waiting' || ((a.status === 'extracted' || a.status === 'rendering') && !a.audioKey)))
    .count();
  return n > 0;
}

/** Hidden with work left: ask for a background sync, which runs (and retries) after the app closes. */
async function handOff(reg: SyncReg): Promise<void> {
  try {
    if (reg.sync && (await workLeft())) await reg.sync.register('reader-work');
  } catch {
    /* not supported or not allowed */
  }
}

/** Installed on Android: a refresh every few hours (Chrome decides how often), to download finished audio. */
async function askForRefresh(reg: SyncReg): Promise<void> {
  try {
    if (!reg.periodicSync) return;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (status.state === 'granted') await reg.periodicSync.register('reader-refresh', { minInterval: 3 * 60 * 60 * 1000 });
  } catch {
    /* not supported */
  }
}
