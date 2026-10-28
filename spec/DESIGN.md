# Read-Aloud Reader: Design Spec

Oct 28, 2026 · @Andrew · v1.0 (handoff)

The design spec for a personal "listen later" app: save an article, it joins a queue, and it's read aloud in a natural voice, online or offline. This replaces the design brief. Pair it with SPEC.md, which covers the engineering.

The visual reference is the "Read-Aloud Reader" design canvas, page **Hybrid (final)**. Where this doc and the canvas disagree, this doc wins. The **Explorations** page holds the rejected directions and is not a reference.

## Changes from the brief

Read these first if you've seen the brief.

| Area | Brief | Decision |
| --- | --- | --- |
| Visual direction | Explore Editorial, Ambient, Material-native | **Hybrid:** Editorial base, with Ambient's pill control bar, and playback controls tinted from the article's art (see Article tint) |
| Sleep timer | In Now Playing's secondary row | **Removed** from v1. No button, no mode, no setting |
| Secondary row | Speed, auto-advance, sleep, lyrics | **Speed, auto-advance, read along** (3 pills) |
| Tap row | Play, or open a preview | **Plays immediately** (or resumes) |
| Swipe right | Move to top, or mark played | **Mark played**, which moves the row to Archive |
| Finished articles | Disappear, dim, or Archive | **Move to Archive** (a section at the bottom of the queue). Settings keeps "delete instead" as an option |
| Shared text | Not covered | Text (not a URL) shared from another app opens the **Add sheet on the Text tab**, prefilled |
| Up-next peek | Peek or swipe | **Peek** of the next article at the bottom of Now Playing |
| Reorder handles | Always, or edit mode | **Only in multi-select mode** |
| Lyrics dimming | All dimmed text at 4.5:1 | Already-read text drops to about 2.6:1 (see Accessibility) |
| Voice choice | Global or per-article | **One global voice**, picked from the on-device model's voices in Settings. First run only picks **voice quality** (the model download size). No picker in the player |
| Speed | Default speed plus a player picker | **One global speed.** The player picker and Settings edit the same value, and it persists |

## Product and principles

This is a podcast player for articles. Listening is the main job and reading is secondary.

**Who it's for:** the owner on a Pixel 8, then a handful of friends who install it from a link. No accounts; everything lives on each phone.

**Core loop:** find an article anywhere, share it to the app, later press play and listen through the queue.

1. **Audio first.** Every screen answers "what's playing and what's next." The player is never more than one tap away.
2. **One-handed and eyes-free.** Primary controls sit in the bottom third.
3. **Calm, not busy.** No feeds, badges, streaks, or guilt counts.
4. **Honest status.** Always show what's happening, how far along it is, and whether an article plays offline.
5. **Forgiving.** Destructive actions undo. Everything resumes where you left off.
6. **Native-feeling.** Standard Android gestures, dark mode, and system text size.

## Platform and constraints

| Constraint | Design implication |
| --- | --- |
| Pixel 8, about 412 × 915 dp | Designed at 412 wide. Must hold at 360 and 390 |
| Installed PWA, standalone | No browser chrome. Set the status-bar color per theme (`bg` token). Respect safe areas and the gesture bar: 28 dp top inset in the mocks, 20 dp bottom margin under the mini player |
| Android share sheet | A shared URL adds a row and opens the Queue (see Share-sheet arrival). Shared plain text opens the Add sheet on Text. Many apps send links in the `text` field ("Headline https://…"): if the shared text is a URL, or short text ending in one, treat it as a link |
| Lock screen / notification | Only title, site, artwork, standard controls. Artwork order: article art, site art, generated cover |
| On-device audio takes minutes | Rendering progress is first-class (row status, buffered scrubber) |
| Offline | One slim banner, no layout shift. Disable only network actions (Retry, cloud voices, voice download). Rendering keeps working offline |
| Light and dark | Both required; follow the system. Dark is primary |
| Text size | Hold at 130% without truncating titles to one line; key controls survive 200% |

## Navigation

The Queue is the hub. Now Playing opens from the mini player on any screen. Lyrics view is a mode inside Now Playing. Settings is a pushed screen from the Queue header. The Add sheet, speed picker, and Partial explainer are bottom sheets.

Ways in: app icon → Queue; share sheet → Queue (URL) or Add sheet on Text (text); invite link → First run → empty Queue.

## Design tokens

### Color

The theme follows `prefers-color-scheme`. All text pairs below meet 4.5:1 unless noted.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F6F2E9` | `#16140F` | Screen background, status bar |
| `surface-sheet` | `#FBF8F1` | `#1F1C16` | Bottom sheets |
| `fg` | `#1D1A15` | `#EDE6D8` | Primary text and icons |
| `muted` | `#5C5548` | `#A99F8D` | Secondary text, upcoming lyrics |
| `past` | `#A39A8A` | `#625A4D` | Already-read lyrics only (about 2.6:1, see Accessibility) |
| `line` | `#DED6C6` | `#2C2820` | Dividers, phone/sheet borders |
| `fill` | `#E7E0D2` | `#2B2720` | Placeholder art, chips, segmented tracks, sheet grabber |
| `track` | `#DCD3C2` | `#38332A` | Scrubber and progress tracks |
| `row-playing` | `#ECE5D5` | `#221E17` | Currently playing queue row |
| `row-selected` | `accent` at 10% | `accent` at 10% | Selected rows; newly shared row |
| `accent` | `#1F5C55` | `#8FD0C3` | App actions: add, save, select, toggles, links |
| `on-accent` | `#F6F2E9` | `#0F2420` | Text/icons on `accent` |
| `warn` | `#8A5300` | `#E5B456` | Partial state |
| `error` | `#A3261A` | `#F2907F` | Failed state, delete, "Clear all" |
| `input-border` | `#8F8676` | `#6E6657` | Text fields (3:1 against `bg`) |
| `mini-bg` | `#1D1A15` | `#2A261E` | Mini player (always dark) |
| `mini-fg` / `mini-muted` | `#F6F2E9` / `#C2B9A8` | `#EDE6D8` / `#B3AA98` | Mini player text |
| `mini-track` | `#3A352C` | `#3E382D` | Mini player progress track |
| `toast-bg` / `toast-fg` | `#2A261E` / `#F6F2E9` | `#EDE6D8` / `#1D1A15` | Snackbars (inverse of theme) |
| `toast-action` | `#8FD0C3` | `#1F5C55` | Snackbar action text |
| `scrim` | `rgba(10,8,5,0.48)` | same | Behind bottom sheets |

**Rule of two accents:** `accent` (teal) is for the app: your queue, adding, selecting, settings. The **article tint** is only for playback: things that control or show "this article." Never mix them in one control.

### Article tint

Playback controls take their color from the current article's artwork, clamped so they stay calm and legible.

**Source color:** the dominant non-neutral color of the art shown in Now Playing (article art, else site art, else the generated cover's background). Compute once at save time and store it with the article.

**Clamp, in OKLCH:**

1. If chroma `C < 0.03` (near-gray, black, or white art), fall back to `accent` for both themes. Example: The Margin's black art.
2. Cap chroma at `C ≤ 0.10`.
3. Set lightness per theme, keeping hue:
   - **Light theme `tint`:** L clamped to 0.30–0.45.
   - **Dark theme `tint`:** L clamped to 0.78–0.86.
4. Derive:
   - `on-tint`: light theme = `bg`; dark theme = same hue at L 0.20, C 0.04.
   - `tint-ink` (text on washes): light = `tint`; dark = `tint` at L +0.04.
   - `tint-wash` (pill background): `tint` at 10% alpha (light), 14% (dark).
   - `tint-rendered` (buffered segment): `tint` at 38% alpha.
5. Verify `on-tint` on `tint` ≥ 4.5:1 and `tint-ink` on `bg` ≥ 4.5:1. If either fails, step L toward the extreme by 0.02 until it passes.

**Worked examples**

| Article art | Light `tint` | Dark `tint` |
| --- | --- | --- |
| Civic Ledger slate `#2E4057` | `#2E4057` (already in band) | `#B3C6E0` |
| Field & Circuit plum `#5B2A6E` | `#5B2A6E` | `#D9BEE6` |
| The Margin black `#151515` | falls back to `accent` | falls back to `accent` |

**Where the tint is used:** play/pause, auto-advance "on" pill (filled), speed and Read-along pills (wash + ink), scrubber fill and thumb, buffered segment, speed-picker slider and stepper, Lyrics current-sentence underline, Back-to-current pill, mini player progress line.

**Where it is not used:** backgrounds, the Up-next peek (that article has its own color), anything on the Queue except the mini player progress.

**Mini player:** it's always on a dark surface, so its progress line uses the dark-theme `tint` in both themes.

**Transition:** when the playing article changes, crossfade tint tokens over 250 ms (snap with reduced motion).

### Type

Two families: **Literata** (serif, for content and titles) and **IBM Plex Sans** (UI). Self-host both for offline. All times and durations use `font-variant-numeric: tabular-nums`. Sizes in sp; respect system scale.

| Role | Family | Size / line height | Weight |
| --- | --- | --- | --- |
| Screen title ("Up next", "Settings") | Literata | 30 / 1.2 (Settings 24) | 500 |
| First-run headline | Literata | 32–36 / 1.12 | 500 |
| Now Playing title | Literata | 21 / 1.25 | 600 |
| Generated cover title | Literata | 33 / 1.1 | 500 |
| Lyrics body | Literata | 23 / 1.48 | 400 |
| Lyrics heading | Literata | 19 / 1.3 | 600 |
| Sheet title | Literata | 22–23 / 1.25 | 500 |
| Queue row title | Literata | 16 / 1.3, max 2 lines | 500 (600 when playing) |
| URL-as-title (Fetching, Failed) | Plex Sans | 14.5 / 1.35, break-all | 400, `muted` |
| Body / helper | Plex Sans | 15–16 / 1.55 | 400 |
| Row meta, captions | Plex Sans | 13 | 400 |
| Section label ("Archive", "Up next") | Plex Sans | 12, uppercase, 0.08em tracking | 600 |
| Buttons | Plex Sans | 14–16 | 600 |
| Times | Plex Sans | 12.5, tabular | 400 |

### Space, size, shape

- **Grid:** 4 dp base.
- **Gutters:** 20 on lists and sheets, 32 on Now Playing, 24 on sheets with large controls, 28 on First run.
- **Queue row:** padding 12 × 20, art 52 square, 14 gap, minimum height 76.
- **Radii:**
  - Art 6 (52), 5 (40–44), 8 (Now Playing cover)
  - Mini player and snackbars 14, cards 16, sheets 24 (top corners)
  - Pills and buttons fully rounded
- **Touch targets:** 48 minimum.
  - Pills 44 tall, with 48 effective hit area.
  - Play/pause 84 (Now Playing), 64 (Lyrics transport).
  - Side transport buttons 56.
- **Elevation:** only the cover (soft shadow), the mini player, snackbars, and Back-to-current. Everything else is flat with `line` dividers.

### Icons

One outline set, 1.8 stroke, round caps (Material Symbols Outlined is fine). Play/pause and the status glyphs below are filled where noted. Never use color alone to carry state.

## Article states

Every row shows a 16 dp status glyph at the start of its meta line, then text. Each glyph has a distinct shape, so states read in grayscale.

| State | Glyph | Meta text (example) | Color | Playable |
| --- | --- | --- | --- | --- |
| Fetching | Dotted circle | "Fetching page…" | `muted` | No |
| Rendering | Ring with progress arc | "**Preparing 42%** · ~22 m · Site" | text `fg` | Yes, to rendered point |
| Queued for audio | Clock | "Queued for audio · ~11 m · Site" | `muted` | No |
| Ready | Circle with down-arrow | "18 m · Offline · Site" | `muted` | Yes, offline too |
| In progress / Playing | Equalizer bars | "**Playing** · 14 m left · Site" + 3 dp progress bar | `accent` label | Yes |
| Partial | Half-filled circle | "**Partial** · 6 m found · Site" | `warn` | Yes, what was found |
| Failed | Triangle with ! | "**Couldn't load the page**" + Retry button | `error` | No |
| Waiting for connection | Cloud with slash | "Will fetch when online" | `muted` | No |
| Played (Archive) | Check | "Played · Site" | Title and art dimmed (`muted`, art 60% opacity) | Yes, if audio kept |

- Fetching, Failed, and Waiting rows show the URL (domain + path) as the title until a real title arrives, with a link glyph on `fill` as placeholder art.
- Durations are estimated at the current speed and update when speed changes.
- **TalkBack:** rows read as "Title, site, 14 minutes, ready" (state last).
- **Data mapping:** these are display states derived from the data model in SPEC.md §9. Partial is a flag on the extraction, not a pipeline step, so a partial article still renders and plays. SPEC.md §9a has the full mapping.

## Screens

### 1. Queue (home) · artboard "Queue"

- **Header:** "Up next" (Literata 30), then a line with count and total time at speed ("8 articles · 2 h 46 m at 1.4×"). Settings (sliders icon) and Add (filled `accent` circle, 48) on the right.
- **List:**
  - Up next rows in order, then an **Archive** section label and archived rows.
  - The currently playing row uses `row-playing`.
  - Rows are separated by space, not dividers. One divider sits under the header and one above Archive.
- **Mini player:** pinned at the bottom (see 2).
- **Empty state** · artboard "Empty queue / …":
  - Share glyph in a 88 circle, "Nothing queued yet", and "Share an article from any app and it lands here, ready to play."
  - Then an "or paste a link" text button that opens the Add sheet.
  - No mini player.
- **Offline:**
  - A 36 dp banner under the header on `fill`: cloud-slash glyph and "Offline · ready articles still play."
  - Retry buttons are disabled (`input-border` color, cloud-slash glyph) and described by the row note.
  - Nothing else changes.

### 2. Mini player

- **Layout:** `mini-bg` card, 14 radius, 12 side margin, 20 above the gesture bar.
- **Contents:**
  - A 3 dp progress line on top: dark `tint` on `mini-track`.
  - 44 art, title (1 line, Literata 15), "Site · 14 m left," and a 48 play/pause.
- **Gestures:** tap or swipe up expands to Now Playing with a shared-element transition on the art.

### 3. Now Playing · artboard "Now Playing"

Top to bottom:

1. **Top bar (56):** collapse chevron, "From your queue" (caps label), open-original link.
2. **Cover (348 square, 8 radius, soft shadow):**
   - Shows article art, else site art, else the generated cover.
   - Generated cover:
     - Background = the source color, unclamped.
     - Site name in caps (top left) and the site mark (top right).
     - A short rule, then the title in Literata 33, bottom-aligned.
     - Text in a light tone of the hue.
3. **Title** (Literata 21/600) and **byline** ("Author · Site").
4. **Scrubber:**
   - 4 dp `track`, `tint` fill, 14 thumb.
   - Elapsed left, remaining right ("−14:05"). Remaining time accounts for speed.
5. **Transport (96 tall):**
   - Order: previous sentence, back N s, **play/pause (84, `tint`)**, forward N s, next sentence.
   - N = skip interval setting.
   - Long-press back/forward skips to the previous or next article.
6. **Control bar** (3 pills, space-between, 32 gutters):
   - Speed: wash pill showing "1.4×" that opens the speed picker.
   - Auto-advance: icon pill; filled `tint` when on, wash when off.
   - Read along: wash pill with icon and label; filled when on.
7. **Up next peek:**
   - Divider, then an "Up next" caps label.
   - 40 art, then title and status ("Preparing 42% · Field & Circuit").
   - Neutral colors. Tap opens the queue.

**While still rendering** · artboard "… still rendering":
- The scrubber shows three layers: played (`tint`), rendered (`tint-rendered`), and not yet rendered (`track` with a subtle dash pattern).
- A center label under the scrubber reads "Preparing audio · 42%."
- Seeking past the rendered point snaps back to it.

### 4. Lyrics view · artboard "Lyrics view …"

Toggled by Read along. The cover area and metadata collapse into a compact header (collapse, 36 art, title, byline, open original). The article text fills the middle, and a compact transport stays at the bottom.

- **Text:** Literata 23/1.48, 28 gutters. Headings and paragraph breaks are kept.
- **Three tiers:**
  - **Already read:** `past`.
  - **Current sentence:** `fg`, with a **wavy underline** in `tint`: 2 dp thick, 7 dp offset, `text-decoration-skip-ink: none`.
  - **Upcoming:** `muted`.
- **Auto-follow:**
  - The current sentence sits about one third from the top.
  - Scrolling eases (about 300 ms). The emphasis crossfades over 150 ms.
- **Manual scroll:**
  - Pauses auto-follow.
  - Shows a **Back to current** pill (filled `tint`, arrow pointing toward the current sentence) 18 dp above the transport.
  - Tapping the pill resumes auto-follow.
- **Tap a sentence:** seeks there.
- **Compact transport:**
  - A 3 dp tinted scrubber with times.
  - Then speed pill, back, play/pause (64, `tint`), forward, and the Read-along pill (filled, since it's on).
- **Reduced motion:** scroll snaps, no crossfade.
- **Stretch:** word-level emphasis, with the underline drawing under each word as it's spoken.

### 5. Add sheet · artboard "Add sheet …"

Bottom sheet on `surface-sheet`, scrim behind. Header: "Add to queue" and close. Segmented control: **Link | Text**.

- **Link tab:**
  - A large `accent` button (72 tall): clipboard glyph, "Paste link," and a one-line preview of the clipboard URL. It is disabled with "No link on your clipboard" when empty.
  - Below an "or type it" divider: a URL field with an Add button (disabled until valid).
  - Tip: "Share › Read-Aloud from any app. If a page won't load, switch to Text."
- **Text tab:**
  - Title (optional; first line is used if blank), then the article text (Literata 15) with a word count and listen estimate.
  - "Save to queue" (full width, `accent`).
- **Shared text arrival:** opens on Text, prefilled, with a status row: "Text shared from <app>. Add a title, then save."
- **After saving:** the sheet closes and the new row appears at the bottom of Up next in its first state (Fetching for links, Queued for audio for text).

### 6. Share-sheet arrival · artboard "Share-sheet arrival …"

- The Queue opens, scrolled so the new row is visible.
- The new row is highlighted with `row-selected` and a "**New**" label in its meta.
- A snackbar ("Saved to your queue") sits above the mini player with **Move to top** and **Play now**.
- It auto-dismisses after 6 s, and the highlight fades with it.
- Built to shrink to a native "Saved" toast later.

### 7. Multi-select · artboard "Multi-select …"

- **Enter:** long-press a row.
- **Header** (on a slightly darker `bg`): close, "N selected," Select all.
- **Rows:** a checkbox (accent-colored) leads; selected rows use `row-selected`; drag handles appear at the trailing edge.
- **Bottom action bar** (replaces the mini player): Delete (`error`), Move to top, Mark played, Re-render, Retry. Each has an icon over a label.
  - Disable Retry if no failed row is selected.
  - Disable Re-render if nothing renderable is selected.
- **Delete:** exits selection and shows the "N articles deleted · Undo" snackbar for 6 s.
- **Swipe left on a row:** delete, with the same snackbar.
- **Swipe right:** mark played, with a "Moved to Archive · Undo" snackbar.
- **"Clear all"** (Settings only) is the one action with a confirmation dialog.

### 8. Speed picker · artboard "Speed picker / …"

- **Sheet layout:**
  - "Speed" label, with "This article: 14 m left" on the right (updates live).
  - The current value in Literata 56, then a − slider + row: 0.8×–3.0× in 0.1 steps, `tint` slider, wash stepper buttons.
  - Five preset pills: 1.0, 1.25, 1.5, 1.75, 2.0.
- **Behavior:** changes apply immediately to everything and persist. Settings shows and edits the same value.
- **Slider accessibility:** announces "1.4 times."

### 9. Partial and Failed explainer · artboard "… Partial explainer"

Tapping a Partial row's status (or a Failed row) opens a sheet:

- Art, title, site.
- The state glyph, then "Only part of this article loaded" and "We found about 6 minutes of it. The rest is probably behind a sign-in or paywall."
- Actions:
  - **Paste the full text** (primary; opens the Add sheet on Text, prefilled with the title, and replaces the article on save).
  - **Open original** (outline).
  - **Play what's here** (text button).
- **Failed variant:**
  - Heading "Couldn't load this page," with a one-line reason.
  - Actions: Retry (primary), Paste the text, Open original.

### 10. Settings · artboard "Settings …"

Pushed screen: back arrow and "Settings." A grouped list with caps section labels and `line` dividers.

- **Voice:**
  - A radio list of the model's voices: name, a short descriptor ("Warm · US English"), and a 48 play-sample button. The first two show inline; "More voices" opens the full list. Voices share one model, so switching voice downloads nothing. Samples are short bundled clips, so they work before the model finishes.
  - Voice quality: "High · Downloaded · 330 MB." Opens a choice of High (330 MB) or Standard (92 MB). Switching downloads the other model and offers to re-render queued articles.
  - Engine: segmented "On this phone | Cloud," with helper text "Cloud voices use your own API key and need a connection." Choosing Cloud opens a provider and API key screen. **Not yet designed:** use a plain form (provider picker, key field, "Test voice" button, voice list from the provider).
- **Playback:**
  - Speed (opens the speed picker; same value as the player).
  - Skip interval (segmented 10s / 15s / 30s).
  - Auto-advance switch.
  - "When an article finishes": Archive / Delete.
- **Storage:**
  - Total used (Literata 28).
  - A stacked bar plus legend (Audio, Voice, Art; legend uses shape and color).
  - Persistent storage status ("Storage is protected" with a shield glyph, or a warning plus "Allow" if not granted).
  - "Delete audio for archived articles" (shows space freed; text is kept).
  - Export queue, Import queue.
  - "Clear all articles…" (`error`, confirms).
- **About:** "Invite a friend" with a Share button (system share of the invite link), and the version.

### 11. First run · artboard "First run …"

Three steps with a progress-dot indicator: the active dot is 20 wide, done/active dots are `accent`, and pending dots are `fill`.

1. **Welcome:**
   - A small stack of generated covers, then "Articles, read aloud." and one sentence of value.
   - **Install the app** (primary; triggers the PWA install prompt) and "Continue in the browser."
2. **Download the voice:**
   - A short line on privacy and Wi-Fi, then a radio list of quality cards with size and a sample button: High quality (330 MB) and Standard (92 MB).
   - High quality is marked Recommended and preselected. The default voice is used; picking a different voice happens in Settings.
   - Choosing a quality starts its download, shown inside the card: "Downloading · 148 of 330 MB" and a time estimate.
   - **Continue** is enabled immediately: "The download keeps going in the background."
   - Disabled offline, with a note.
3. **Save from anywhere:**
   - Three numbered steps: tap Share, choose Read-Aloud (schematic share row with our icon ringed), "It's in your queue."
   - A one-liner about the + button.
   - **Go to my queue** lands on the empty Queue.
   - A "Voice 71%" status chip in the top right shows while the download continues.

Until the voice is ready, saved articles stay in "Queued for audio," with a meta note: "Waiting for voice download."

## Interactions and motion

| Interaction | Behavior |
| --- | --- |
| Tap row | Play (or resume) immediately |
| Tap Partial/Failed status | Open the explainer sheet |
| Swipe row left | Delete, undo snackbar |
| Swipe row right | Mark played → Archive, undo snackbar |
| Long-press row | Multi-select |
| Drag handle (multi-select) | Reorder |
| Tap / swipe up mini player | Expand to Now Playing, shared-element art |
| Swipe down on Now Playing | Collapse |
| Long-press back / forward | Previous / next article |
| Tap speed pill | Speed picker sheet |
| Tap sentence (lyrics) | Seek |
| Scroll (lyrics) | Pause follow, show Back to current |
| Pull to refresh | None |

- **Motion:** most transitions under 250 ms, standard easing; sheets slide up at 250 ms.
- **Snackbars:** stay 6 s; only one at a time, and a newer one replaces the older.
- **Reduced motion:** removes the shared-element transition (crossfade instead), lyrics easing, and the tint crossfade.

## Artwork

Same two layers as the brief:

- **Site art** (`apple-touch-icon` → manifest icons → favicon as a tiny badge only) for rows, the mini player, and the lock-screen fallback.
- **Article art** (`og:image` / `twitter:image`, cropped square) for Now Playing.

Both are stored at save time.

**Generated cover** is the fallback in every art slot (see Now Playing 2):

- **Small slots (40–52):** just the site's initials (1–3 characters, Literata 600) centered on the source color.
- **Background:** if the site has no art, derive one from a hash of the domain into a fixed palette of 8 muted hues at OKLCH L 0.40–0.50, C 0.08.

## Accessibility

Target WCAG 2.2 AA.

- **Touch targets:** at least 48 × 48.
- **Contrast:** text at least 4.5:1; non-text indicators at least 3:1.
- **Exception (lyrics):** already-read text uses `past` at about 2.6:1.
  - It's intentional: the text has been heard, it isn't needed to operate the UI, and Lyrics view is off by default for screen-reader users.
  - If this needs to be strict, set `past` = `muted` and let the underline alone carry emphasis.
- **State:** every state shows a glyph and text, never color alone.
- **TalkBack:**
  - Rows read "Title, site, duration, state."
  - The scrubber and speed controls announce values.
  - Toggles use `aria-pressed` / `role=switch`.
  - The current sentence is marked `aria-current`.
- **Scaling:** font scale up to 200% without clipping transport or pills. Pills wrap to two rows if needed.
- **Reduced motion:** as above.

## Out of scope and open questions

**Out of scope for v1:**
- Accounts and sync, saving from a laptop
- Highlights and notes, tags and search
- A feed, a reading mode without audio
- **Sleep timer**, per-article voices

**Still open:**
- [ ] Name and wordmark. "Read-Aloud" is a working name used in copy and the share target. The icon and wordmark wait on this.
- [ ] Native later (SPEC.md §12): the arrival snackbar becomes a system toast without opening the app.
