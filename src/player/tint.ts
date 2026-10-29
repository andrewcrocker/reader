import { articleTint, type TintSet } from '../theme/color';

// Applies the playing article's tint (DESIGN "Article tint") to :root. The vars are registered as
// <color> so they can crossfade over 250 ms (styles.css; reduced motion snaps).

const KEYS: [keyof TintSet, string][] = [
  ['tint', 'tint'],
  ['onTint', 'on-tint'],
  ['ink', 'tint-ink'],
  ['wash', 'tint-wash'],
  ['rendered', 'tint-rendered'],
];

let registered = false;
function register() {
  if (registered || typeof CSS === 'undefined' || !('registerProperty' in CSS)) return;
  registered = true;
  const fallback = articleTint(undefined);
  for (const mode of ['light', 'dark'] as const) {
    for (const [k, name] of KEYS) {
      try {
        CSS.registerProperty({ name: `--${name}-${mode[0]}`, syntax: '<color>', inherits: true, initialValue: fallback[mode][k] as string });
      } catch {
        /* already registered (HMR) */
      }
    }
  }
}

export function applyTint(source: string | undefined): void {
  register();
  const t = articleTint(source);
  const style = document.documentElement.style;
  for (const mode of ['light', 'dark'] as const) {
    for (const [k, name] of KEYS) style.setProperty(`--${name}-${mode[0]}`, t[mode][k] as string);
  }
}
