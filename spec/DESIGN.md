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
| Finished articles | Disappear, dim, or Archive | **Move to Archive** (a section on the Saved tab). Settings keeps "delete instead" as an option, except for loved articles |
| Navigation | Queue as the only hub | **Bottom tab bar:** Subscriptions, Up next, Saved. Up next is home |
| Keeping and sharing favorites | Not covered | **Love** an article (a heart) to keep it, apart from Archive, which only means done. **Saved** is the place for what you want to keep: loved articles first, then the archive. It can be shared: a **Share** button there sends a list of what you loved this week or all time, with a card image (see Reading lists) |
| Finding new articles | A feed inbox, not designed yet | **Subscriptions:** pull only. You add a blog's address from the Subscriptions header, the tab lists your blogs with how many posts are new, and nothing joins the queue until you tap Add on a post |
| Shared text | Not covered | Text (not a URL) shared from another app opens the **Add sheet on the Text tab**, prefilled |
| Up-next peek | Peek or swipe | **Peek** of the next article at the bottom of Now Playing |
| Reorder | Handles always, or in edit mode | **Hold a row and drag it.** Handles appear only in multi-select |
| Lyrics dimming | All dimmed text at 4.5:1 | Already-read text drops to about 2.6:1 (see Accessibility) |
| Voice choice | Global or per-article | **One global voice** from three (Heart, Bella, Michael), picked in Settings. No picker in the player or First run |
| Voice engine | On-device, with optional cloud | **Online (server Kokoro) only.** No engine or quality choice in Settings or First run |
| Speed | Default speed plus a player picker | **One global speed.** The player picker and Settings edit the same value, and it persists |
| Neutrals | Warm cream and brown (as drawn on the canvas) | **Toned down:** every neutral token keeps its lightness and hue at a quarter of the canvas chroma (OKLCH), so it reads as a barely warm gray. Contrast is unchanged. The canvas still shows the older, warmer values |



## Product and principles

This is a podcast player for articles. Listening is the main job and reading is secondary.

**Who it's for:** the owner on a Pixel 8, then a handful of friends who install it from a link. No accounts; everything lives on each phone.

**Core loop:** find an article anywhere, share it to the app, later press play and listen through the queue.

1. **Audio first.** Every screen answers "what's playing and what's next." The player is never more than one tap away.
2. **One-handed and eyes-free.** Primary controls sit in the bottom third.
3. **Calm, not busy.** No streaks, badges, or guilt counts, and nothing that pushes: Subscriptions is pull only. New posts are marked one way everywhere: a small `accent` dot. It sits on the Subscriptions tab, on a blog's row (there with a plain count, "3 new"), and beside a post. No red, and no count on the tab bar.
4. **Honest status.** Always show what's happening, how far along it is, and whether an article plays offline.
5. **Forgiving.** Destructive actions undo. Everything resumes where you left off.
6. **Native-feeling.** Standard Android gestures, dark mode, and system text size.

## Platform and constraints

| Constraint | Design implication |
| --- | --- |
| Pixel 8, about 412 × 915 dp | Designed at 412 wide. Must hold at 360 and 390 |
| Installed PWA, standalone | No browser chrome. Set the status-bar color per theme (`bg` token). Respect safe areas and the gesture bar: 28 dp top inset in the mocks, 12 dp bottom margin under the mini player |
| Android share sheet | A shared URL adds a row and opens the Queue (see Share-sheet arrival). Shared plain text opens the Add sheet on Text. Many apps send links in the `text` field ("Headline https://…"): if the shared text is a URL, or short text ending in one, treat it as a link |
| Lock screen / notification | Only title, site, artwork, standard controls. Artwork order: article art, site art, generated cover |
| On-device audio takes minutes | Rendering progress is first-class (row status, buffered scrubber) |
| Offline | One slim banner, no layout shift. Disable only network actions (Retry, cloud voices, voice download). Rendering keeps working offline |
| Light and dark | Both required; follow the system. Dark is primary |
| Text size | Hold at 130% without truncating titles to one line; key controls survive 200% |

## Navigation

A **bottom tab bar** switches between three views: **Subscriptions | Up next | Saved**. Up next is the hub and the home view, in the middle. Archive is a section of Saved, not a tab. Now Playing opens from the mini player on any tab. Lyrics view is a mode inside Now Playing. Settings is a pushed screen from the Up next header, with no tab bar. A blog's posts open one level into Subscriptions, and keep the tab bar. The Add sheet, speed picker, Partial explainer, and the share sheets are bottom sheets.

Ways in: app icon → Up next; share sheet → Up next (URL) or Add sheet on Text (text); `#add=` link → Up next; `#list=` link → Up next, with the reading-list sheet open (see Reading lists); invite link → First run → empty Up next. The app always opens on Up next. The tab isn't remembered between launches.

**Back:** Up next is the bottom of the back stack. Subscriptions and Saved each sit one step above it, so back from either returns to Up next. Switching between those two swaps in place, and tapping Up next does the same as back. A blog's posts sit one step above Subscriptions, so back from them returns to the list of blogs. Choosing another tab from a blog's posts leaves the blog first, so the stack never holds more than it shows, and tapping Subscriptions there goes back to the list.

**Tab bar:**
- **Layout:** three equal tabs in a 64 tall bar, plus the bottom safe-area inset, on `bg` with a `line` top border. Each tab is an outline icon over a 12 label.
- **Current tab:** a `row-selected` pill behind the icon, the icon and label in `accent`, and the label at 600. Other tabs are `muted`. It's marked with `aria-current="page"`, so state isn't carried by color alone.
- **Dock:** the bar is the last item in the bottom dock. The snackbar and mini player sit above it, and the bar gives way to the multi-select action bar while selecting.
- **New-post dot:** a 9 dp filled `accent` dot at the top right of the Subscriptions icon, with a 2 dp ring in the background color. The tab's accessible name becomes "Subscriptions, new posts". A blog's posts count as seen when you leave that blog (or the app goes to the background while it's open); the dot goes when no blog has any left.

**Between a phone and two panes (481 to 719 px):** the single column fills the window instead of sitting in the middle. Sheets and Now Playing stay 480 wide, centered. First run and the invite screen stay phone-width.

**Wide screens (720 px and up):** two panes. At 720 they are 360 each. The Up next, Subscriptions, Saved, or Settings view is a column on the left, at most 440 wide, with the tab bar at the bottom of that column. Now Playing (or Lyrics view) stays open on the right. There's no mini player, collapse control, or swipe-down, and the Up next peek isn't a link because the queue is already beside it. The cover shrinks to fit the screen height. Sheets stay bottom sheets.


## Design tokens

### Color

The theme follows `prefers-color-scheme`. All text pairs below meet 4.5:1 unless noted.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F3F2F0` | `#151413` | Screen background, status bar |
| `surface-sheet` | `#F9F8F6` | `#1D1C1B` | Bottom sheets |
| `fg` | `#1B1A19` | `#E8E6E3` | Primary text and icons |
| `muted` | `#575652` | `#A2A09B` | Secondary text, upcoming lyrics |
| `past` | `#9D9B97` | `#5D5B58` | Already-read lyrics only (about 2.6:1, see Accessibility) |
| `line` | `#D9D7D3` | `#292826` | Dividers, phone/sheet borders |
| `fill` | `#E2E0DD` | `#282726` | Placeholder art, chips, segmented tracks, sheet grabber |
| `track` | `#D6D4CF` | `#353331` | Scrubber and progress tracks |
| `row-playing` | `#E7E5E1` | `#1F1E1D` | Currently playing queue row |
| `row-selected` | `accent` at 10% | `accent` at 10% | Selected rows; newly shared row |
| `accent` | `#1F5C55` | `#8FD0C3` | App actions: add, save, select, toggles, links |
| `on-accent` | `#F3F2F0` | `#0F2420` | Text/icons on `accent` |
| `warn` | `#8A5300` | `#E5B456` | Partial state |
| `error` | `#A3261A` | `#F2907F` | Failed state, delete, "Clear all" |
| `input-border` | `#898783` | `#696763` | Text fields (3:1 against `bg`) |
| `mini-bg` | `#1B1A19` | `#272624` | Mini player (always dark) |
| `mini-fg` / `mini-muted` | `#F3F2F0` / `#BCBAB5` | `#E8E6E3` / `#ADABA6` | Mini player text |
| `mini-track` | `#373533` | `#3A3936` | Mini player progress track |
| `toast-bg` / `toast-fg` | `#272624` / `#F3F2F0` | `#E8E6E3` / `#1B1A19` | Snackbars (inverse of theme) |
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

**Where the tint is used:** play/pause, auto-advance "on" pill (filled), speed and Read-along pills (wash + ink), scrubber fill and thumb, buffered segment, speed-picker slider and stepper, Lyrics current-sentence highlight, Back-to-current pill, mini player progress line.

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

**Heart:** a soft, rounded outline heart (round lobes, a blunt point), `muted`, when an article isn't loved. Loved is the same shape filled and in `accent`, so the shape changes as well as the color. The same heart is the Saved tab's icon and the share card's eyebrow glyph. It's an app action, not playback, so it uses `accent` and never the article tint.

## Article states

Every row shows a 16 dp status glyph at the start of its meta line, then text. Each glyph has a distinct shape, so states read in grayscale.

| State | Glyph | Meta text (example) | Color | Playable |
| --- | --- | --- | --- | --- |
| Fetching | Dotted circle | "Fetching page…" | `muted` | No |
| Rendering | Ring with progress arc | "**Preparing 42%** · ~22 m · Site" | text `fg` | Yes, to rendered point |
| Queued for audio | Clock | "Queued for audio · ~11 m · Site" (online voices: "Preparing… · ~11 m · Site" once sent) | `muted` | No |
| Waiting for voices | Clock | "Waiting for voices · ~11 m · Site" (the server's daily voice budget is spent) | `muted` | No |
| Ready | Circle with down-arrow | "18 m · Site" | `muted` | Yes, offline too |
| In progress / Playing | Equalizer bars | "**Playing** · 14 m left · Site" + 3 dp progress bar | `accent` label | Yes |
| Partial | Half-filled circle | "**Partial** · 6 m found · Site" | `warn` | Yes, what was found |
| Failed | Triangle with ! | "**Couldn't load the page**" + Retry button | `error` | No |
| Waiting for connection | Cloud with slash | "Will fetch when online" | `muted` | No |
| Played (Archive) | Check | "Played · Site" | Title and art dimmed (`muted`, art 60% opacity), except under Loved on Saved, which stays bright | Yes, if audio kept |

- Fetching, Failed, and Waiting rows show the URL (domain + path) as the title until a real title arrives, with a link glyph on `fill` as placeholder art.
- Durations are estimated at the current speed and update when speed changes.
- **TalkBack:** rows read as "Title, site, 14 minutes, ready" (state last).
- **Data mapping:** these are display states derived from the data model in SPEC.md §9. Partial is a flag on the extraction, not a pipeline step, so a partial article still renders and plays. SPEC.md §9a has the full mapping.

## Screens

### 1. Queue (home) · artboard "Queue"

- **Header:** "Up next" (Literata 30), then a line with count and total time at speed ("8 articles · 2 h 46 m at 1.4×"). Settings (sliders icon) and Add (filled `accent` circle, 48) on the right.
- **List:**
  - Up next rows in order. Archived rows are on the Saved tab.
  - Each row ends with a **heart** button (48 touch target, 22 icon; label `Love “Title”` or `Remove “Title” from loved`). Tapping it loves or unloves without playing. It's hidden in multi-select and on Failed rows (which have Retry). Unloving has no snackbar: the heart's shape is the confirmation.
  - The currently playing row uses `row-playing`.
  - Rows are separated by space, not dividers. One divider sits under the header.
- **Mini player and tab bar:** pinned at the bottom, the mini player above the tab bar (see 2 and Navigation).
- **Empty state** · artboard "Empty queue / …":
  - Share glyph in a 88 circle, "Nothing queued yet", and "Share an article from any app and it lands here, ready to play." It also shows when everything left is archived.
  - Then an "or paste a link" text button that opens the Add sheet.
  - No mini player.
- **Offline:**
  - A 36 dp banner under the header on `fill`: cloud-slash glyph and "Offline · ready articles still play."
  - Retry buttons are disabled (`input-border` color, cloud-slash glyph) and described by the row note.
  - Nothing else changes.
- **Reorder** (Up next only): hold a row for about 400 ms. It lifts (a light buzz, a shadow, 2% larger) and follows the finger; the rows it passes slide apart to show where it will land, and the list scrolls when the row nears the top or the mini player. Let go to drop it. Moving more than about 8 px before the hold fires scrolls, swipes, or does nothing, as usual, so a long list never reorders by accident. Holding and letting go without moving enters multi-select, as a long-press always did. With a mouse, press and hold the same way. On wide screens each row's ⋯ menu also has **Move up** and **Move down**. Reduced motion: no lift scale, and the slot opens instantly.
- **Voices busy** (online voices, daily budget spent): the same banner with a clock glyph and "Voices are busy right now. Your articles will finish later." Affected rows read "Waiting for voices"; they start again on their own after the reset (midnight UTC). Offline wins if both apply.

### 1a. Saved

The last tab. The same rows, gestures, and multi-select as Up next, except that rows can't be reordered: a hold goes straight to multi-select. It shows one list at a time, picked from the header's ⋮ menu. Header: "Saved", a line that counts the list on show ("8 favorites" or "12 archived"), a **Share** icon button (the share glyph in a plain 48 icon button, like Settings on Up next; disabled when nothing loved can be shared), and a ⋮ button. Nothing in the header is `accent`-filled.

- **⋮ menu:** a small-caps "Show" label over two choices, with a check mark on the current one: **Favorites** (the default) and **Archived**. The choice is remembered.
- **Favorites:** every loved article, newest love first, whether or not it's archived. Rows aren't dimmed. With none, a `muted` line: "Tap the heart on an article to keep it here. You can share your favorites."
- **Archived:** every archived article, most recently played first, dimmed as played. A loved one is listed here too, since the two lists are never on screen together. With none, a `muted` line: "Articles you've listened to land here."
- Swipe left deletes; swipe right marks played unless the row is archived. Multi-select has the same header (including Share as list), Select all and action bar as Up next. Mark played is disabled if every selected row is archived. Move to top returns an archived row to Up next. Select all takes the list on show.
- **Empty state** (nothing loved or archived): the heart glyph, "Nothing saved yet", "Love an article to keep it here, and share your favorites. Articles you've listened to land here too."

### 2. Mini player

- **Layout:** `mini-bg` card, 14 radius, 12 margin on the sides and 12 above the gesture bar, so the gaps match.
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
3. **Title** (Literata 21/600) and **byline** ("Author · Site"), with the **heart** button at the end of the title block, aligned to the 32 gutter. Lyrics view has the same heart before the open-original link.
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
  - **Current sentence:** `fg` on a **highlight**: `tint` at 20% behind the text, 5 radius, 3 dp side padding, cloned across line breaks.
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
- **Stretch:** word-level emphasis, with the highlight moving across each word as it's spoken.

### 5. Add sheet · artboard "Add sheet …"

Bottom sheet on `surface-sheet`, scrim behind. Header: "Add to queue" and close. Segmented control: **Link | Text | PDF**.

- **Link tab:**
  - A large `accent` button (72 tall): clipboard glyph, "Paste link," and a one-line preview of the clipboard URL. It is disabled with "No link on your clipboard" when empty.
  - Below an "or type it" divider: a URL field with an Add button (disabled until valid).
  - Tip: "Share › Reader from any app. If a page won't load, switch to Text."
- **Text tab:**
  - Title (optional; first line is used if blank), then the article text (Literata 15) with a word count and listen estimate.
  - "Save to queue" (full width, `accent`).
- **PDF tab:**
  - The same large `accent` button: upload glyph, "Choose a PDF," "From your files" (or the reason a file was refused: not a PDF, over 50 MB). It opens the system file picker.
  - Hint: Reader pulls out the text and reads it aloud; Read along shows it. Share › Reader from Files works too, as does a PDF link on the Link tab. Scanned PDFs have no text.
  - Choosing a file saves it straight away; the row reads "Preparing" while the text is pulled out, then goes on as usual. Its site label is "PDF."
- **Shared text arrival:** opens on Text, prefilled, with a status row: "Text shared from <app>. Add a title, then save."
- **After saving:** the sheet closes and the new row appears at the bottom of Up next in its first state (Fetching for links and PDFs, Queued for audio for text).

### 6. Share-sheet arrival · artboard "Share-sheet arrival …"

- The Queue opens, scrolled so the new row is visible.
- The new row is highlighted with `row-selected` and a "**New**" label in its meta.
- A snackbar ("Saved to your queue") sits above the mini player with **Move to top** and **Play now**.
- It auto-dismisses after 6 s, and the highlight fades with it.
- Built to shrink to a native "Saved" toast later.

### 7. Multi-select · artboard "Multi-select …"

- **Enter:** hold a row and let go without moving it (holding and moving reorders; see Queue). On Saved a hold goes straight to multi-select, since nothing there reorders.
- **Header** (on a slightly darker `bg`): close, "N selected," Share as list (share glyph; see 14), Select all.
- **Rows:** a checkbox (accent-colored) leads; selected rows use `row-selected`; drag handles appear at the trailing edge. A focused handle moves its row with the up and down arrow keys.
- **Bottom action bar** (replaces the mini player and the tab bar): Delete (`error`), Move to top, Mark played, Re-render, Retry. Each has an icon over a label.
  - Disable Retry if no failed row is selected.
  - Disable Re-render if nothing renderable is selected.
- **Delete:** exits selection and shows the "N articles deleted · Undo" snackbar for 6 s.
- **Swipe left on a row:** delete, with the same snackbar.
- **Swipe right:** mark played, with a "Moved to Archive · Undo" snackbar. Archived rows are already played, so they only swipe left.
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

### 10. Subscriptions

The first tab. It's pull only: the blogs you follow are listed here with how many posts are new, and nothing is added to the queue, fetched, or rendered until you tap **Add** on a post.

- **Header:** the same as Up next. "Subscriptions" (Literata 30) and a line such as "4 blogs · Checked 12 m ago". On the right, a ⋮ button (48, plain, shown once there's a subscription) and **Add** (48, `accent`-filled, plus glyph; `aria-label` "Add a subscription").
- **⋮ menu:** the popup menu rows use. **Refresh** (circular arrow) checks every blog now: a snackbar says "Checking for new posts…", then "3 new posts" or "No new posts". Under a `line` rule and a small-caps "Sort by" label, two choices with a check mark on the current one: **Recent** (the blog that posted last comes first; the default) and **Alphabetical**. The choice is remembered.
- **Blogs:** one row per blog, 72 tall.
  - **Picture:** 44, 5 radius. The blog's icon if it has one, else its initials on a color from its address, like article art.
  - **Name:** Literata 16, one line.
  - **New posts:** under the name, an 8 dp filled `accent` dot and a count in `accent` 600 ("3 new"), then the date of the latest post in `muted` ("· Nov 26"). With nothing new, just the date. A blog that couldn't be checked shows a warning glyph and why in place of the date ("Couldn't check. The page wasn't found (404).").
  - **⋮ and chevron:** a ⋮ menu with **Refresh** (checks this blog now) and **Delete** (`error`; removes the blog and its posts, with an Undo snackbar "Deleted Vitalik Buterin's website"), then a right chevron. The whole row opens the blog; the chevron does the same.
- **Empty state:** the feed glyph in an 88 circle, "No subscriptions yet", "New posts from the blogs you follow show up here.", and an outline "Add a blog" button that opens the Add sheet. The header's Add button is there too.
- **When it checks:** on launch, when the app comes back to the front, and on Refresh. A blog checked in the last 30 minutes is skipped, except by Refresh. Only the newest 20 posts of a blog are considered.

**Add a subscription** (bottom sheet, built like Add to queue's Link tab): a large `accent` **Paste address** button ("From your clipboard", or the address when it can be read), an "or type it" divider, a "Blog address" field (`type="text"`, so a bare domain like `vitalik.eth.limo` works) with a **Subscribe** button, and a hint ("Paste a blog's address, or its feed address. New posts show up in Subscriptions, and you pick which ones to add."). Subscribe is disabled while the field is empty, while it's looking ("Looking…"), and offline. Errors show as a `fill` note ("Couldn't find a feed at that address.", "You're already subscribed to that.") and the text stays so it can be fixed. On success the sheet closes and a snackbar says "Subscribed to Vitalik Buterin's website". The posts already on the blog count as seen, so subscribing doesn't light a dot.

### 11. A blog's posts

One level into Subscriptions, opened from a blog's row. The tab bar stays.

- **Header:** the same height as the tab headers. A back arrow ("Back to subscriptions"), then the blog's name (Literata 24, one line) over a line such as "3 new · 12 of 20 posts · Checked 12 m ago", and a ⋮ button at the end.
- **⋮ menu:** a small-caps "Show" label over four choices, with a check mark on the current one: **Unplayed** (the default), **Played**, **Favorites** and **All**. The choice is remembered, and is the same for every blog. A post is played once the article made from it has been listened to; a post never added is unplayed. Favorites are posts whose article has a heart.
- **Posts:** newest first. A row has the title (Literata 16, 2 lines) and a short date ("Nov 26").
  - **New:** an 8 dp `accent` dot in the row's left margin, level with the title, so titles stay aligned whether or not a post is new. It reads "New." to a screen reader. Posts stay marked until you leave the blog.
  - **Add:** a 48 icon button at the end, a plus in a ring, in `accent` (`aria-label` "Add <title> to your queue"). A snackbar says "Saved to your queue". A post that's already an article isn't added twice: the snackbar says "Already in your queue".
  - **Added:** the button becomes a filled `accent` disc with a check, which isn't a button ("Added to your queue").
  - **Played and favorite:** each post has two states, added or not and played or not, and they show separately. A played post has a `muted` 400-weight title, like a played row in Up next, and its meta line starts "Played ·". A favorite has a small filled `accent` heart and "Favorite ·" there. The button at the end still says whether it is in the queue: a played post that was cleared from the queue shows Add again.
- **Empty:** a `muted` line: "No posts yet.", or for a view with nothing in it "No unplayed posts.", "No played posts yet.", "No favorites from this blog yet."

### 12. Settings · artboard "Settings …"

Pushed screen: back arrow and "Settings." The top level is a menu: **Voice**, **Playback**, and **Storage** rows (each with a one-line summary and a chevron), then an outline "Invite a friend" button, and the version at the foot. Each row pushes its own page with a back arrow; back returns to the menu. Pages use caps section labels and `line` dividers. The Voice page is just the three voices.

- **Voice:**
  - A radio list of three voices: **Heart** (default), **Bella**, **Michael**: name, a short descriptor ("Warm · US English"), and a 48 play-sample button. Samples are short bundled clips, so they work offline and before any download.

- **Playback:**
  - Speed (opens the speed picker; same value as the player).
  - Skip interval (segmented 10s / 15s / 30s).
  - Auto-advance switch.
  - Chimes switch ("A short sound when an article starts and ends").
  - "When an article finishes": Archive / Delete. The line under it says what the choice does: "Moves to Archive, where you can replay it" or "Deleted with its audio, except loved articles". A loved article is archived instead of deleted, because loving it says you want to keep it.
- **Storage:**
  - Total used (Literata 28).
  - A stacked bar plus legend (Audio, Voice, Art; legend uses shape and color).
  - Persistent storage status ("Storage is protected" with a shield glyph, or a warning plus "Allow" if not granted).
  - "Delete audio for archived articles" (shows space freed; text is kept).
  - Export queue, Import queue.
  - "Clear all articles…" (`error`, confirms).
- **About:** "Invite a friend" with a Share button (system share of the invite link), and the version.

### 13. First run · artboard "First run …"

Two steps with Online voices (the default): Welcome, then Save from anywhere. The voice download step appears only for on-device voices, making three. Progress dots: the active dot is 20 wide, done/active dots are `accent`, and pending dots are `fill`.

1. **Welcome:**
   - A small stack of generated covers, then "Articles, read aloud." and one sentence of value.
   - **Install the app** (primary; triggers the PWA install prompt) and "Continue in the browser."
2. **Download the voice** (on-device voices only):
   - A short line on privacy and Wi-Fi, then a radio list of quality cards with size and a sample button: High quality (330 MB) and Standard (92 MB).
   - High quality is marked Recommended and preselected. The default voice is used; picking a different voice happens in Settings.
   - Choosing a quality starts its download, shown inside the card: "Downloading · 148 of 330 MB" and a time estimate.
   - **Continue** is enabled immediately: "The download keeps going in the background."
   - Disabled offline, with a note.
3. **Save from anywhere:**
   - Three numbered steps: tap Share, choose Reader (schematic share row with our icon ringed), "It's in your queue."
   - A one-liner about the + button.
   - **Go to my queue** lands on the empty Queue.
   - A "Voice 71%" status chip in the top right shows while the download continues.

With on-device voices, saved articles stay in "Queued for audio" until the voice is ready, with a meta note: "Waiting for voice download."

### 14. Reading lists

A snapshot of some articles, sent as one link (SPEC §4). Nothing is uploaded and nothing stays in sync: the link holds the list. There are two ways to make one: **hand-picked** (Share as list, from multi-select) and **from Saved** (This week or All time). Both make the same link and open the same way.

- **Share as list** (multi-select header, share glyph): a sheet with a line on what it does, an optional **List name** field (placeholder "Reading list"), the articles in queue order (title in Literata, site under it), and **Share N articles** (primary). It opens the system share sheet with just the link (no extra text, so Copy gives a clean URL; the name travels inside the link), or copies the link where there isn't one.
  - Only links can go in. Pasted text is left out, with a `status-note` in the sheet ("1 pasted article wasn't included: only links can be shared.") and the same note in the snackbar afterwards.
  - Past about 2,000 characters the note also warns that some apps may cut the link off. The link still works.
  - Sharing exits selection and shows "Link copied" or "List shared" in the snackbar.
- **Share from Saved** (the Saved header's Share button): a bottom sheet that builds the list from what you've loved, with the card attached. Top to bottom:
  - **Range:** a two-segment control, **This week** (the calendar week so far: loved since Monday 00:00, local time, through Sunday 23:59, so the count resets on Monday) and **All time**, each with its count. A range with 0 items is disabled; the sheet opens on This week, or All time if that's empty (as it is on a Monday morning). A line under it says what the range means.
  - **Preview** of the card (1200 × 630: Reader's teal with the headline on the left and a dark player on the right). It's drawn live: it changes with the range, the name, and with anything the card shows about an article (title, site, color, art, length) as those arrive. It's an image, not a link preview, and the play mark is part of the picture.
    - The player's top part is the first article: its tile (100), dimmed, with a light play triangle on it so the art still shows, its title in Literata 34 and its site under it. Below is a scrubber at 0:00, with the article's length at the right end.
    - Under that, on a slightly darker step, are up to three more articles as roomy rows: a 66 tile, the title in Literata 26 (two lines at most, then an ellipsis) and "site · N min" in `muted`. Then one "+ N more" in `accent`, in line with the titles.
    - There is no big play button, no skip buttons and no total time.
    - A list of one is just the first article, drawn larger. A list of two has one row and no "+ N more". Titles that wrap take more room, so the card shows fewer rows rather than clipping any.
  - **Your name** (optional, 40 characters, remembered on the device) and **A note** (optional, one line, 140). The list is named "Zach's reading this week" / "Zach's all-time favorites", or "Worth reading this week" / "All-time favorites" with no name. The name is the headline on the card and the title of the list when it's opened.
  - If the range holds more than fits in one link, a `status-note` says so plainly: "Only the 18 most recently loved fit in one link. The other 22 aren't included." The card shows the ones that are included.
  - **Share** (primary, full width): opens the system share sheet with the card image and the link, and nothing else. Where the device can't share files, or sharing the image fails, it shares the plain link, or copies it. If the share sheet is dismissed the sheet stays open. Done, it closes with "List shared" or "Link copied" in the snackbar.
  - **Copy link** and **Save image**: two quiet text buttons under Share, for desktop and for apps that drop attachments. Each shows "Link copied" or "Image saved" in place of its label for a moment.
  - A one-line note: it sends the card with one link, nothing is uploaded, and it's a snapshot, so hearts you add or remove later don't change it.
- **Opening a list link:** the Queue opens with a sheet titled with the list name (or "Reading list"), then "A reading list someone shared · N articles · M already in your queue."
  - If the sender added a **note**, it sits under that line as quiet text (`muted`, 14.5, with a `line` rule at its left), above the articles. Links made without one look as they always did.
  - Each article is a checkbox row: title, then site. All start checked. Articles already in the queue (by URL, Archive included) show unchecked and disabled, with "Already in your queue."
  - **Add all to Up next** (primary) becomes "Add N to Up next" when some are unchecked. Each one is added like a pasted link, at the end of Up next, and the snackbar says "N articles added to Up next."
  - A damaged link shows a snackbar instead: "That reading list link is damaged. Ask for it again."

## Interactions and motion

| Interaction | Behavior |
| --- | --- |
| Tap a tab | Switch view. Back from Subscriptions or Saved returns to Up next |
| Tap the heart (row, Now Playing, Lyrics) | Love or unlove, no snackbar |
| Tap Share (Saved header) | Open the share sheet |
| Tap Add (Subscriptions header) | Open the Add a subscription sheet |
| Tap Subscribe (Add a subscription) | Looks up the feed; on success closes the sheet and shows a "Subscribed to …" snackbar |
| Tap a blog's row or chevron | Open that blog's posts. Back returns to the list of blogs |
| ⋮ on a blog › Refresh / Delete | Check that blog now / remove it and its posts, undo snackbar |
| ⋮ in the Subscriptions header | Refresh every blog, or sort by Recent or Alphabetical |
| Tap Add on a post | Add it to Up next ("Saved to your queue" snackbar) |
| Tap row | Play (or resume) immediately |
| Tap Partial/Failed status | Open the explainer sheet |
| Swipe row left | Delete, undo snackbar |
| Swipe row right | Mark played → Archive, undo snackbar (rows that aren't archived) |
| Hold row, then drag (Up next) | Reorder |
| Hold row, then let go (or hold on Saved) | Multi-select |
| Drag handle (multi-select) | Reorder |
| Move up / Move down (⋯ menu, wide) | Reorder by one |
| Tap / swipe up mini player | Expand to Now Playing, shared-element art |
| Swipe down on Now Playing | Collapse |
| Long-press back / forward | Previous / next article |
| Tap speed pill | Speed picker sheet |
| Tap sentence (lyrics) | Seek |
| Scroll (lyrics) | Pause follow, show Back to current |
| Pull to refresh | None |

- **Motion:** most transitions under 250 ms, standard easing; sheets slide up at 250 ms. Going a level in (a blog's posts, Settings, a Settings page) the new screen fades in while sliding 32 from the right over 280 ms; coming back out, the screen you return to does the same from the left. The dock stays still. Switching tabs doesn't animate.
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
- **State:** every state shows a glyph and text, never color alone. The current tab has a pill and a heavier label. The new-post dot is a shape, and the Subscriptions tab is named "Subscriptions, new posts".
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
- A reading mode without audio
- Notifications, background checks, or auto-adding posts from a feed
- **Sleep timer**, per-article voices

**Still open:**
- [x] Name: **Reader** (2026-10-28), used in copy, the share target, the page title and link previews. The URL is `pocketreader.me` (2026-11-21); `read-aloud-c1w.pages.dev` still works.
- [ ] Wordmark and icon.
- [ ] Native later (SPEC.md §12): the arrival snackbar becomes a system toast without opening the app.
