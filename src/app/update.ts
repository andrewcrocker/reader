import { registerSW } from 'virtual:pwa-register';

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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg?.update();
      else tryApply();
    });
  },
});

// <audio> pause and ended events don't bubble; listen in the capture phase.
document.addEventListener('pause', tryApply, true);
document.addEventListener('ended', tryApply, true);
