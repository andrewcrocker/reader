# Handoff: hybrid design implementation (WIP)

Branch `design-wip`, started from `main` (baseline). Goal: implement the "Read-Aloud Reader" design canvas, page **Hybrid (final)** (https://claude.ai/code/artifact/cf29e93e-c2d7-4d9a-b99d-f988e05772ef), per `spec/DESIGN.md` and `spec/SPEC.md`. DESIGN.md wins where it and the canvas disagree. Delete this file when the work lands.

## State

- `npm test`: 42 passing (includes new tests below).
- `npm run typecheck`: **3 errors, all in the old UI** (`src/pages/Home.tsx`, `src/pages/SettingsPanel.tsx`), which the new screens replace. Nothing new has been run in a browser yet.

## Done (foundation, no screens yet)

| Area | Files | Notes |
|---|---|---|
| Data model (SPEC §9) | `src/db.ts` | Dexie v2 + upgrade: `partial` status → `extractionQuality` flag; `source`, `domain`, art keys, `tintSource`, `archivedAt`, `deletedAt`, `blocks`; new `art` table; Settings gains `engineKind`, `voiceQuality`, `voiceModel`, `lyricsOn`, `onboarded`, `skipSeconds: 10\|15\|30`. `firstQueueOrder()`, `domainOf()` helpers. |
| Article tint | `src/theme/color.ts` (+ test) | OKLCH ⇄ hex, WCAG contrast, `articleTint()` implementing DESIGN "Article tint" steps 1–5 (neutral fallback to accent, C ≤ 0.10, per-theme L bands, derived on-tint/ink/wash/rendered, contrast stepping). `domainColor()` (8-hue palette), `coverInk()`. |
| Display states (SPEC §9a) | `src/queue/display.ts` (+ test) | `displayState()`, `rowMeta()` (glyph, tone, meta segments, progress, TalkBack string), `queueSummary()`, duration/speed/URL-title formatting. |
| Tokens + styles | `src/styles.css` | All DESIGN color tokens, light/dark, tint CSS vars (`--tint-l/-d`, `--on-tint-*`, `--tint-ink-*`, `--tint-wash-*`, `--tint-rendered-*`; set these on `:root` from `articleTint()`). Class styles for every screen are written but not yet used by components. The `/spike` page keeps a plain `.page` look. |
| Fonts | `package.json` | `@fontsource/literata`, `@fontsource/ibm-plex-sans` installed. **Not yet imported** in `main.tsx` (import 400/500/600 latin), and add `woff2` to Workbox `globPatterns` so they precache. |
| Icons | `src/ui/Icon.tsx` | `Icon`, `SkipIcon` (number inside), `StatusGlyph` (9 state glyphs, distinct shapes). Paths copied from the canvas. |
| Art | `src/art/art.ts`, `src/ui/Art.tsx` | Fetch via proxy `/asset`, downscale ≤512 (square crop), dominant non-neutral color, store in `db.art`; site art keyed `site:<domain>` and shared. `useArtUrl()` ref-counted object URLs. `initials()`, `rasterCover()` (for Media Session). `<Art>` (small slots: site art → article art → initials on source color; link placeholder) and `<Cover>` (Now Playing: article art → site art → generated cover). |
| Worker `/asset` | `worker/src/index.ts` (+ tests) | image/* only, 4 MB cap, sets `Cross-Origin-Resource-Policy: cross-origin` (the app is COEP require-corp). |
| Extraction | `src/pipeline/extract.ts` | Adds `iconUrl` (largest apple-touch-icon) and `quality` via `assessQuality()` (paywall phrases near end, JSON-LD `isAccessibleForFree`/`wordCount`, truncation). Manifest icons not used yet. |
| Script blocks | `src/pipeline/textprep.ts` | `buildScript()` also returns `blocks` (kind/first/count over sentences) for the lyrics view. |
| Runner | `src/pipeline/runner.ts` | `addUrl` (→ `waiting` if offline), `addText` (first line as title), `replaceWithText` ("Paste the full text", same id), `purgeArticle`, `retryArticle`, `rerenderArticle`, `ensureVoiceModel()` (tracks `Settings.voiceModel` progress), artwork after extract, skips deleted/archived, engine errors don't fail articles. `deleteArticle` was removed (use soft delete + `purgeArticle`). |
| Voice quality | `src/tts/engine.ts` | `getSharedEngine(pref, quality, cb)`. high = WebGPU fp32, WASM q8 fallback (the spike's path); standard = WASM q8. Confirm sizes/labels in the spike. |

## Left to do

1. **Queue actions module** (`src/queue/actions.ts`): soft delete + undo + purge after 6 s (and purge leftovers on launch), archive/mark played, move to top (`firstQueueOrder`), reorder (fractional `queueOrder`), clear all, delete audio for archived, export/import JSON (SPEC §11a).
2. **Player provider:** one `<audio>` at the app root shared by mini player, Now Playing, Lyrics. Global speed, skip interval, prev/next sentence, long-press = prev/next article, auto-advance, on-finish archive/delete per `keepPlayed`, position saves (keep the existing §11a logic from `src/pages/Player.tsx`), Media Session with art blobs (or `rasterCover`) and prev/next article. Apply `articleTint(current.tintSource)` to `:root` vars with a 250 ms crossfade.
3. **Screens** (canvas artboards → DESIGN sections): Queue + empty + offline banner (§1), mini player (§2), Now Playing + still-rendering scrubber (§3), Lyrics (§4, rAF + `audio.currentTime`, Back to current, tap to seek, `blocks` for headings/paragraphs), Add sheet with Link/Text tabs and clipboard preview (§5), share arrival snackbar (§6), multi-select + swipe gestures + drag reorder + undo snackbar (§7), speed picker (§8), Partial/Failed explainer (§9), Settings (§10), First run (§11). Snackbar: one at a time, 6 s.
4. **Share target** (SPEC §4): manifest `share_target` GET `/share` (title/text/url), classify link vs text, route in `App.tsx`. Invite link `#invite=<secret>` → store secret → First run.
5. **Manifest/meta:** theme colors from `bg` per scheme, name "Read-Aloud" (placeholder).
6. Delete `src/pages/Home.tsx`, `Player.tsx`, `SettingsPanel.tsx` once replaced; keep `/spike`.
7. Verify: typecheck, tests, build, then screenshot each screen at 412 px in light and dark against the canvas.

## Known gaps (spec says yes, not planned in this pass)

- Progressive playback while rendering (`renderedUntilSec`): audio only exists after the full render. Now Playing can show the three-layer scrubber, but play is disabled until ready.
- Cloud TTS (BYO key) form and Worker `/tts`.
- Extraction ladder steps 2–5 (SPEC Phase 3).
