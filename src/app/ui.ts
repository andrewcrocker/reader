import { useSyncExternalStore } from 'react';

// App-wide UI state: which overlay is open and the one snackbar. Overlays push a history entry so
// Android's back gesture closes the top one (sheet, then Now Playing, then Settings).

export type Sheet =
  | { kind: 'add'; tab: 'link' | 'text'; text?: string; title?: string; shared?: boolean; replaceId?: string }
  | { kind: 'speed' }
  | { kind: 'explain'; id: string };

export interface SnackAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Snack {
  id: number;
  text: string;
  actions?: SnackAction[];
  /** Runs when the snackbar leaves without an action (timeout, replaced): e.g. purge after delete. */
  onDone?: () => void;
}

/** Settings is a menu with one level of pages under it. */
export type SettingsPage = 'menu' | 'voice' | 'playback' | 'storage';

interface UiState {
  settings: SettingsPage | null;
  nowPlaying: boolean;
  sheet: Sheet | null;
  snack: Snack | null;
  /** Row highlighted after a share arrives (DESIGN §6). */
  newId?: string;
}

let state: UiState = { settings: null, nowPlaying: false, sheet: null, snack: null };
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function useUi(): UiState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export const getUi = () => state;

// ---- Wide layout: Queue on the left, Now Playing always open on the right ----

const WIDE = '(min-width: 900px)';
const wideQuery = matchMedia(WIDE);

export function useWide(): boolean {
  return useSyncExternalStore(
    (fn) => {
      wideQuery.addEventListener('change', fn);
      return () => wideQuery.removeEventListener('change', fn);
    },
    () => wideQuery.matches,
  );
}

function push(patch: Partial<UiState>) {
  history.pushState({ overlay: true }, '');
  set(patch);
}

export const openSettings = () => !state.settings && push({ settings: 'menu' });
export const openSettingsPage = (page: Exclude<SettingsPage, 'menu'>) => push({ settings: page });
/** Opens the Now Playing overlay. In the wide layout it's already on screen, so this does nothing. */
export const openNowPlaying = () => !state.nowPlaying && !wideQuery.matches && push({ nowPlaying: true });


export function openSheet(sheet: Sheet) {
  // Sheet to sheet (explainer -> Add) swaps in place rather than stacking.
  if (state.sheet) set({ sheet });
  else push({ sheet });
}

/** Close the top overlay through history, so the back stack stays in step. */
export function back() {
  if (state.sheet || state.nowPlaying || state.settings) history.back();
}

window.addEventListener('popstate', () => {
  if (state.sheet) set({ sheet: null });
  else if (state.nowPlaying) set({ nowPlaying: false });
  // A settings page goes back to the menu; the menu goes back to the queue.
  else if (state.settings) set({ settings: state.settings === 'menu' ? null : 'menu' });

});

// ---- Snackbar: one at a time, 6 s, a newer one replaces the older (DESIGN "Interactions") ----

export const SNACK_MS = 6000;
let snackTimer: ReturnType<typeof setTimeout> | undefined;
let nextSnackId = 1;

function finish(s: Snack | null) {
  s?.onDone?.();
}

export function showSnack(s: Omit<Snack, 'id'>): void {
  const prev = state.snack;
  clearTimeout(snackTimer);
  const snack = { ...s, id: nextSnackId++ };
  set({ snack });
  finish(prev);
  snackTimer = setTimeout(() => dismissSnack(snack.id), SNACK_MS);
}

export function dismissSnack(id?: number, ranAction = false): void {
  const s = state.snack;
  if (!s || (id !== undefined && s.id !== id)) return;
  clearTimeout(snackTimer);
  set({ snack: null, ...(state.newId ? { newId: undefined } : {}) });
  if (!ranAction) finish(s);
}

export async function runSnackAction(a: SnackAction): Promise<void> {
  const s = state.snack;
  dismissSnack(s?.id, true);
  await a.run();
  // An action like Move to top still means the snackbar's pending work should happen.
  if (a.label !== 'Undo') finish(s);
}

export const setNewId = (newId: string | undefined) => set({ newId });
