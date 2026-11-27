# Read-Aloud Reader: Technical Spec (v0.2)

Working title. A personal, Pocket-style "listen later" app. Save an article, it gets queued, and it's read to you in a good voice, online or offline.

Status: reconciled with DESIGN.md (Oct 28, 2026). DESIGN.md owns screens, states, and visual behavior; this doc owns architecture, data, and pipeline. Open questions are collected at the bottom.

**Changes in v0.2**

- Sleep timer removed from v1 (§7, §14).
- Shared plain text is a capture path, with a rule for telling links from text (§4).
- "Paste the full text" can replace a partial article's content (§4, §5).
- `partial` moves from a status to an extraction-quality flag, so partial articles still render and play (§9).
- New fields: stored artwork, article tint color, soft delete for undo, archive (§9).
- Display-state mapping for the queue rows (§9a).
- One global playback speed; skip interval is 10/15/30 s (§7).
- Voice quality (model size) is separate from voice choice (§6.3).
- Feed inbox moved out of Phase 2 to "Later" (§14). It has since been built (§4c).
- Answered open questions: voice preference, finished articles, reading mode (§15).

---

## 1. Goals

**Primary: listening.** The app exists to read articles aloud. Reading on screen is secondary.

1. Save an article from the phone with minimal friction.
2. Maintain a queue of saved articles.
3. Read articles aloud with a high-quality voice.
4. Playback controls: speed, skip forward/back (time and sentence), auto-advance to the next article. No sleep timer in v1.
5. Optional "lyrics view": article text that highlights and scrolls in sync with the audio.
6. Full offline playback (airplane mode) for anything already saved.
7. Basic CRUD: multi-select, delete with undo, archive, clear, reorder.
8. Extraction handles most sites well, escalates through fallbacks when it doesn't, and gets past soft paywalls where possible.
9. **Shareable with friends.** Send someone a URL and they can use it, with no account. Voices run on a server the owner pays for (about 1¢ an article), capped per day so the cost can't run away (§6.3).
10. **Pocket-style saving.** Share an article and close the app; the audio is waiting the next time it opens.

**Non-goals (for now)**

- Accounts, logins, or sync. Everything lives on the device. The one exception: rendered audio waits on the server (R2) until the app downloads it, then it's deleted (7 days at most).
- Multi-device support. One phone (Pixel 8 / Chrome).
- Highlights, notes, tags, search. These might come later.
- A reading mode without audio.
- Sleep timer, per-article voices.
- Getting past hard paywalls, where the server never sends the text. Archives and pasted text are the only routes for those.

---

## 2. Architecture overview

```
┌──────────────────────── Phone (installed PWA) ────────────────────────┐
│                                                                       │
│  Share target (URL or text) / paste URL / paste text                  │
│        │                                                              │
│        ▼                                                              │
│  Extraction pipeline (runs in browser: DOMParser + Readability)       │
│        │  raw HTML via proxy · artwork fetched + stored               │
│        ▼                                                              │
│  TTS prep: clean text → sentences → chunks                            │
│        │                                                              │
│        ▼                                                              │
│  TTS engine: Kokoro on the server (default; renders in the background)│
│              (on-device Kokoro remains in code, not offered)          │
│        │                                                              │
│        ▼                                                              │
│  Render: per-chunk audio → concatenated file + timing map             │
│        │                                                              │
│        ▼                                                              │
│  Local storage: IndexedDB (articles, queue, timings, art)             │
│                 OPFS / IndexedDB blobs (audio)                        │
│        │                                                              │
│        ▼                                                              │
│  Player: <audio> + Media Session API + lyrics view                    │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS, shared-secret header
                                ▼
            ┌──────────────────── Cloudflare Worker ────────────────────┐
            │  GET  /fetch?url=…   → raw HTML (+ fallback modes)         │
            │  GET  /asset?url=…   → image bytes (artwork)               │
            │  POST /render        → starts a background render job     │
            │                        (Workflow → voice host → R2)        │
            │  GET  /render/:job[/:i], DELETE /render/:job               │
            └───────────────────────────────────────────────────────────┘
```

**Why this shape**

- **A PWA can't fetch other sites directly** because of CORS, so a thin proxy is required. Fetching is effectively free at friends-and-family scale (Workers free tier is 100k requests/day), so sharing the proxy costs nothing. TTS is the only real cost: about 1¢ per article on the server, capped per day.
- **Voices render on the server by default** because on-device rendering failed on a Pixel 8 (2026-10-28): loading the model peaked at 1.35 GB and Android killed the page, the GPU is taken away in the background, and it ran barely faster than real time while heating the phone.
- **CPU-heavy work runs on the phone, not the Worker.** The Workers free plan allows about 10ms of CPU per request, and network wait time doesn't count toward that. Fetching and proxying TTS are I/O; Readability parsing is CPU. The browser has a native `DOMParser`, so jsdom isn't needed.
- **Audio is pre-rendered to files at save time**, not synthesized live. The Web Speech API on Android Chrome is unreliable once the screen is off and doesn't fire the word-boundary events highlighting needs. Pre-rendered files fix both problems and make offline playback trivial.
- **No accounts.** A shared secret keeps the fetch proxy from being an open proxy for strangers. Friends get it through an invite link (§10a), so they never type it.

---

## 3. Tech stack (proposed)

| Layer | Choice | Notes |
|---|---|---|
| App | Vite + TypeScript + React | Swap for Svelte or Preact if preferred |
| PWA | `vite-plugin-pwa` (Workbox) | App-shell caching, manifest, share target |
| Local DB | Dexie (IndexedDB) | Articles, queue, timings, settings, artwork blobs |
| Audio storage | OPFS, falling back to IndexedDB blobs | Call `navigator.storage.persist()` on first run |
| Extraction | `@mozilla/readability` | Plus custom fallbacks (§5) |
| Sentence splitting | `Intl.Segmenter` (sentence granularity) | Built in, no dependency |
| Proxy | Cloudflare Worker (+ Hono for routing) | Free tier |
| Hosting | Cloudflare Pages | Free; same account as the Worker |
| TTS | Kokoro on-device (default), BYO-key cloud (optional) | Behind a provider interface (§6.3) |
| Fonts | Literata, IBM Plex Sans | Self-hosted and precached, so type works offline (DESIGN.md) |

---

## 4. Saving articles

**Capture methods**

| Method | Phase | Notes |
|---|---|---|
| **Share sheet: URL** (Android) | v1 | An installed PWA gets this via `share_target`; no sideloading needed. This is the main path. |
| **Share sheet: text** (Android) | v1 | Shared plain text (selected text from a reader or notes app) opens the Add sheet on the Text tab, prefilled, so the user can add a title and save. |
| **Paste URL** | v1 | A prominent "Paste link" button reads the clipboard on tap. Silent clipboard reading on app open isn't allowed in browsers, so it has to be a tap. |
| **Paste text** | v1 | Paste the article body itself. The escape hatch for anything extraction can't reach. Also used to complete a partial article (below). |
| **PDF** | v1 | A link to a PDF (Link tab or share), a PDF shared from Files or a browser, or one chosen on the Add sheet's PDF tab. Its text is pulled out and read like an article (§4b). |
| **Reading list link** | v1 | A friend's `#list=` link (below). Opens a sheet of its articles; the chosen ones are added like pasted links. |
| **Feed inbox** (discovery) | v1 | Subscribe to a blog's RSS/Atom feed by pasting its address (a site address works: the feed is found from the page). New posts wait in **Subscriptions**, a tab separate from the queue, and are never added or rendered until the user taps Add. Pull only: checked on launch, when the app comes back to the front, and on "Check now". See §4c. |
| **Desktop bookmarklet** | Out of scope for v1 | See "Saving from another device" below. |

**v1 = share sheet (URL, text, PDF file) + paste URL + paste text + PDF upload.**

**Share target**

```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text", "url": "url", "files": [{ "name": "file", "accept": ["application/pdf", ".pdf"] }] }
}
```

POST, so the service worker receives the share (§11b): it saves the link or PDF itself, starts work on it that carries on after the app closes, and redirects to `/share?added=<id>`. Shared text is handed to the page as `/share?title=…&text=…`, since it waits for Save. A file that isn't a PDF redirects to `/share?unsupported=<name>`, which shows a snackbar.

Classify each share:
1. If `url` is present, it's a link.
2. Else if `text` is a single URL, or short text (under about 300 characters) containing exactly one URL, it's a link. Many Android apps send links this way ("Headline https://…"). Use the shared `title` or the leading text as a provisional title.
3. Otherwise it's text: open the Add sheet on Text with `text` as the body and `title` (if any) as the title.
4. A shared PDF file is saved with `source: "file"` (the blob waits in `files` until it's read).

A link adds a row and opens the Queue with the arrival highlight (DESIGN.md §6). Text waits for the user to tap Save.

**Share sheet: PWA vs. native**
- PWA: sharing opens the app, which shows the new item in the queue. You then switch back to whatever you were reading. Fine, slightly clunky.
- Native (§12): sharing can show a "Saved" toast and stay in the current app, with rendering happening in the background. The PWA arrival snackbar is designed to shrink to that.
- iPhone: no PWA share target. Use an Apple Shortcut in the share sheet that opens `app/#add=<url>`.

**Sharing a reading list**
Multi-select → **Share as list** turns the chosen articles into one link, so a friend can add them to their own queue. Still no server and no accounts: the list lives in the URL fragment, which browsers never send to a server.

- Format: `https://app/#list=<payload>`, where the payload is base64url of `deflate-raw` (`CompressionStream`) of JSON `{ name?, items: [{ url, title, site? }] }`. Codec and tests in `src/app/share.ts`.
- Only URL articles go in. Pasted text stays on the phone, and the snackbar says how many were left out.
- Shared with `navigator.share`, or copied to the clipboard where that's missing.
- About 10 articles fit in 2,000 characters. Longer lists still work, but the sheet warns that some apps cut long links.
- Opening the link shows the list as a sheet with a checkbox per article (all on). Links already in the queue are skipped. The rest go through the same add-URL path as a pasted link, in list order. The fragment is cleared from the address bar on open, like `#add=`. Decoding drops anything that isn't an http(s) link.
- It's a snapshot: nothing syncs, and the sender's queue isn't touched.

**Saving from another device (the catch with "everything local")**
Because the queue lives only on the phone, a laptop has nowhere to send an article. Options, in order of simplicity:
1. **Don't solve it.** Send the link to yourself and share it from the phone.
2. **QR / handoff page.** A bookmarklet opens a page showing a QR code for the article URL; scan it with the phone to add. No server state, but awkward.
3. **Relay inbox (recommended if this matters).** The phone shows a pairing code once. A desktop bookmarklet POSTs the URL to the Worker under that code, stored in Workers KV with a short TTL. The phone pulls and deletes pending URLs on open. This bends the "no server state" rule slightly.

**Save flow**

1. URL received → create an Article with `status: "fetching"` (or `"waiting"` if offline) and add it to the end of Up next immediately. Pasted or shared text skips to step 3 with `source: "text"`.
2. Extraction pipeline (§5) → `status: "extracted"`, with `extractionQuality` set (or `status: "failed"` with a reason).
3. Fetch and store artwork (site art and article art) through `/asset`, and compute the tint source color (§4a).
4. TTS rendering (§6) → `status: "rendering"` with progress → `"ready"`. Only one article renders at a time; others wait in `"extracted"`. Rendering also waits until the voice model is downloaded.
5. Closing the app doesn't stop this: the service worker carries on for a few minutes, and Background Sync brings it back later (§11b). Anything still left resumes on the next app open.

**Completing a partial article ("Paste the full text")**
The Partial explainer sheet opens the Add sheet on Text, prefilled with the article's title. On save, the pasted body replaces `contentHtml` and `sentences` on the **same** article (keeping its id, queue position, art, and URL), sets `source: "text"` and `extractionQuality: "full"`, discards existing audio, and re-renders. Any listening position resets.

## 4b. PDFs

A PDF arrives as a link (the Worker's `/fetch` passes PDFs through, up to 30 MB, and the app also sniffs `%PDF`), a shared file, or an upload (up to 50 MB). The text is read with pdf.js (`unpdf`, which runs without a DOM, so the service worker can do it too), then cleaned up for listening (`src/pipeline/pdf.ts`):

1. **Reading order.** Text runs are grouped into lines per page. A two-column page is split at its gutter and read left column, then right; full-width lines (title, abstract, wide captions) cut the page into bands. Rotated text (margin stamps, watermarks) is dropped.
2. **Running heads and page numbers.** Lines near the top or bottom of the page are dropped when they repeat (digits ignored) on at least 30% of pages, or look like a page number, a DOI or a URL.
3. **Small print.** Footnote markers (small numerals in a line), tiny text (chart labels) and footnotes below a page's last body line are dropped.
4. **Paragraphs and headings.** Lines join into paragraphs and split on larger gaps, first-line indents and short last lines. A sentence carries on across a page or column break. Words hyphenated across lines are rejoined ("news-/papers" → "newspapers", but "self-/aware" keeps its hyphen). Short lines in larger type, or numbered like "2.1 Methods" on a line of their own, become headings, so §6.1's section skipping (References etc.) applies.
5. **Captions and tables.** Paragraphs starting "Figure 3:" / "Table 2." and runs that are mostly numbers are dropped.

The title is the PDF's metadata title unless it's junk ("Microsoft Word - draft.docx"), else the largest text on page one, else the file name. Scanned PDFs (no text layer) fail with "This PDF is a scan, so there's no text to read." Password-protected ones fail too. Documents over about 150,000 characters (3½ hours) are cut there and marked Partial. The uploaded file is deleted once its text is out; Read along shows the cleaned text.

## 4a. Artwork and tint

- **Site art:** `apple-touch-icon`, then the largest manifest icon, then the favicon (used only as a tiny badge). **Article art:** `og:image` / `twitter:image`. Fetch both through `/asset`, downscale to at most 512 px (article art cropped to square), and store as blobs. Store one site art per domain and share it.
- **Generated cover:** when there's no usable art, the UI draws a typographic cover. For the Media Session API, rasterize the same cover to a 512 px PNG with `OffscreenCanvas` and store it, since lock-screen artwork needs an image URL.
- **Tint source color:** after storing art, compute the dominant non-neutral color of the art shown in Now Playing (article art, else site art, else the generated cover color). Store it as `tintSource` (hex). The per-theme clamp (OKLCH) happens at render time, as specified in DESIGN.md "Article tint." No site art: derive a color from a hash of the domain into the fixed 8-hue palette in DESIGN.md.

---

## 4c. Feed inbox

A way to find articles, not a way to save them. It follows the same rules as the rest of the app: everything stays on the device, nothing is added or rendered by itself, and nothing pushes.

**Subscribe.** The user pastes a site address or a feed address into the field at the top of **Your subscriptions** (see Manage below). Discovery goes through the Worker's `/fetch`, which already passes RSS, Atom and other XML through unchanged:

1. Fetch the address. If it's RSS 2.0, RSS 1.0 or Atom, that's the feed.
2. If it's HTML, take the page's `<link rel="alternate" type="application/rss+xml">` (or `atom+xml`) addresses, resolved against the page's address, first three in page order.
3. Otherwise try `/feed.xml`, `/feed`, `/rss.xml`, `/atom.xml` and `/index.xml` on the same site.
4. If none of those is a feed: "Couldn't find a feed at that address."

The feed is stored under the address it ended up at, so `http://` and `https://` don't make two subscriptions. The latest 20 posts are stored and marked seen, so subscribing doesn't light the new-post dot.

**Manage.** The Subscriptions header has a quiet **Manage** button (a list icon, `aria-label` "Manage subscriptions") next to Check now. It pushes **Your subscriptions**, a full screen like Settings: same back arrow, one history entry, and the same back-gesture behavior (back returns to the inbox). It holds everything about the blogs themselves: the Subscribe field (a text input, so a bare domain works; the validation, errors, loading state and wording above), and one row per blog, newest first, with its title, its host for display (`feedHost()` in `feeds/format.ts`: the feed's `linkBase` host if set, else `siteUrl`, else the feed address; without `www.`), "Checked … ago", any `lastError` ("Couldn't check. …"), and **Remove** with an Undo snackbar. After a successful subscribe the field clears, the blog appears in the list, and a snackbar says "Subscribed to …". The inbox itself shows only posts, plus one muted line "N blog(s) couldn't be checked" that opens Manage when any feed has a `lastError`. With no subscriptions the inbox shows a short line and an "Add a blog" button that opens Manage.

**Check (pull).** `checkFeeds()` runs on launch and whenever the app becomes visible. A feed checked in the last 30 minutes is skipped; "Check now" in Subscriptions ignores that. It does nothing offline or without an invite. For each feed it fetches and parses, and stores only posts not stored yet, as unseen. Only a feed's newest 20 posts are ever considered, so a long feed doesn't flood the inbox on its first check, and stored posts are trimmed to the newest 40 per feed. A feed that fails records a one-line `lastError` (cleared by the next good check) and its check time, so it isn't retried on every launch. A good check also refreshes the feed's title and site address, so a blog that renames itself follows. There are no banners, and nothing is retried in the background.

A check that is already running covers a later one (launch and "back in front" can land together), except "Check now": it waits for that run to end and then checks every feed, so a tap never comes back "No new posts" because of what an earlier, narrower run skipped.

**Moved hosts.** Some blogs move but keep serving their feed from the new host, so the links in it point at a host that no longer answers (Vitalik's feed is on `vitalik.eth.limo` and links to `vitalik.ca`). To read those posts, the feed gets a `linkBase`: the feed's own origin, which post links are rebased onto (same path, query and hash; `rebaseLink()` in `feeds/diff.ts`). It's worked out once, from the newest post only (`probeLinkBase()` in `feeds/discover.ts`), when subscribing, or on the first check of a feed saved before the field existed:
- If that post's link is already on the feed's own host, or the original link answers: `linkBase = null`, keep the links.
- If the original fails and the same path and query on the feed's host answers: `linkBase` is that host's origin.
- If both fail: `null` too. The feed's own host just answered, so it isn't the network.
- If the feed has no posts to judge by: left unset, and looked at again on the next check.

A page the Worker declines to return (too large, not HTML) still counts as answering, since the site did. Rebasing changes only the stored link: a post's id still hashes the guid or link as the feed gave it, so ids don't move when `linkBase` is set. Posts stored before it was set are rebased when they're added to the queue (Add), and the Your subscriptions row shows the host the posts are read from.

**New-post indicator.** A single dot on the Subscriptions tab while any stored post has `seenAt = null`. Posts are marked seen when the user leaves the Subscriptions tab, or when the app goes to the background while that tab is open. Marking them on arrival would clear the per-post markers before anyone could read them.

**Recent label.** Separately from `seenAt`, each feed's three newest stored posts show a small "New" in the meta line, so recent posts stand out from old ones even right after subscribing (when everything is seen). Ranked by `publishedAt`, else `firstSeenAt`, with equal times keeping list order; computed in memory (`recentIds()` in `feeds/diff.ts`), nothing stored. As newer posts arrive the label moves to them.

**Add.** Tapping Add on a post checks the existing articles by address (ignoring the scheme, `www.`, a trailing slash, the `#fragment`, and `utm_` parameters, against both `url` and `canonicalUrl`). If one exists, the post links to it. Otherwise it goes through the normal save flow above (`addUrl`, with the post's title as the provisional title). Either way the post stores `articleId`, and its button reads "Added".

**Out of scope for now:** background or push checks (they'd need a server and state, which breaks the no-accounts rule), OPML import and JSON Feed.

## 5. Extraction pipeline (escalation ladder)

Each step produces a candidate. A **quality check** decides whether to accept it or move to the next step. The method that succeeded is recorded on the article for debugging.

**Quality check** (scored, tunable):

- Word count above a threshold (e.g. 250), or above a meaningful share of any `wordCount` declared in JSON-LD.
- No paywall phrases near the end ("subscribe to continue", "already a subscriber", "this article is for subscribers", …).
- JSON-LD `isAccessibleForFree: false` is a warning flag that triggers comparison against later steps.
- No abrupt truncation (last paragraph ends mid-sentence, or ends in "…").

**Ladder**

| # | Step | Where | Catches |
|---|---|---|---|
| 1 | Plain fetch (browser-like UA) → Readability | Worker fetch, phone parse | Most open sites |
| 2 | Embedded data: JSON-LD `articleBody`, `__NEXT_DATA__`, Apollo/Redux state, `<script type="application/json">` blobs | Phone | Soft paywalls that ship the full text in page data |
| 3 | AMP version (`<link rel="amphtml">`) | Worker + phone | Sites with lighter AMP paywalls |
| 4 | Alternate fetch profiles (no cookies, search/social referrer) | Worker | Some metered walls. ToS-gray; can be disabled per site |
| 5 | Existing archives: Wayback availability API, archive.today newest snapshot | Worker + phone | Hard paywalls, if someone else already archived the page |
| 6 | Graceful failure | Phone | If any text was found: keep the best candidate, set `extractionQuality: "partial"`, continue to render. If nothing usable: `status: "failed"` with a one-line reason |

**What the user sees** (DESIGN.md §9): Partial articles show a Partial row and play what was found. Tapping the status opens the explainer with **Paste the full text**, **Open original**, and **Play what's here**. Failed articles offer **Retry**, **Paste the text**, and **Open original**. If `/archive` finds a snapshot, the explainer can add an "Open archived copy" action (not designed yet; a fourth text button is fine).

**Later:** per-domain overrides (skip straight to step N for known sites), and a "this extraction is bad, retry with the next method" action on any article.

**Known limits:** the Worker fetches from datacenter IPs, which some sites block. If that becomes a real problem, see Alternative B (§12).

---

## 6. Text-to-speech

### 6.1 Text prep

Readability output → plain text optimized for listening:

- Drop: image captions and credits, figure and table contents, "Related:" or "Read more" blocks, newsletter signup and ad slots, footnote markers, bare URLs, code blocks (or replace them with "code sample omitted").
- Keep headings, rendered with a longer pause. Keep heading and paragraph structure in `contentHtml` for the lyrics view.
- Prepend a short intro: title, byline, site. ("From The Atlantic. *Title.* By Author.")
- Normalize abbreviations, symbols, and numbers where the engine handles them badly (tune during the spike).
- Split into sentences with `Intl.Segmenter`, then group them into **chunks** of about 1–3 sentences, under the provider's per-request limit.

### 6.2 Rendering strategy: sentence-chunked synthesis

Each chunk is synthesized separately (on-device or cloud). This approach:

- **Gives timing without depending on the provider.** Each clip's duration gives exact sentence start and end times. That's enough for the lyrics view, which emphasizes by sentence. Word-level emphasis can be approximated by character offsets, or taken from the provider's timestamps if it offers them.
- **Enables progressive playback.** You can start listening before the whole article has rendered. Expose `renderedUntilSec` so the scrubber can draw the rendered segment, and clamp seeks to it.
- **Makes retries cheap.** One failed chunk doesn't fail the article.

After all chunks render, they're **concatenated into one audio file per article**. MP3 frames concatenate cleanly when encoding settings match. A single file keeps background playback seamless, and the timing map (`sentences[i].start/end`) indexes into it.

### 6.3 Engines

Both engines run the same model (**Kokoro-82M**) and the same three voices, **Heart** (default), **Bella**, and **Michael**, so they sound alike and samples are shared.

**Default: Kokoro on the server ("Online").** Plan and spike results: the "Server Kokoro plan" doc.
- The app sends an article's chunks once (`POST /render`); a Cloudflare **Workflow** sends each chunk to a hosted Kokoro API (DeepInfra, $0.99 per million characters) four at a time, strips each MP3's header frame, and stores it in **R2** with its length. Each chunk is a Workflow step, so the job survives crashes and keeps going with the app closed.
- The app collects finished chunks whenever it's open (polling every 2 s while visible), decodes them to 24 kHz PCM into `renderedChunks` like on-device chunks, then builds the file as usual and deletes the server's copy. Streaming playback works the same.
- Spike: a 7.9-minute article rendered in 78 s for 0.73¢; requests take 3–12 s each, mostly queueing at the host.
- **Budget:** one global counter (a Durable Object) allows 330,000 characters a day (about 33 articles, $0.33), which keeps a month under $10. Refused requests get `429 {error:"busy", retryAt}`; the app shows "Voices are busy" and retries after the reset (midnight UTC). The owner gets an email (Resend) at 80% and when the budget runs out, once each per day. DeepInfra's own spending limit is the backstop.
- Article text goes to the voice host; DeepInfra lists zero retention.

**Former default: on-device neural TTS.** Removed from Settings on 2026-10-28; the engine stays in the code for the `/spike` benchmark.
- **Kokoro-82M** via `kokoro-js` (transformers.js), running in the browser on WebGPU, falling back to WASM. Open weights (Apache 2.0). Piper is a lighter fallback with lower quality.
- **Voice quality vs. voice.** The download size depends on the model's quantization (about 92 MB quantized, 330 MB full precision). The design calls these **Standard** and **High quality**, chosen in First run when on-device is the engine. **Voices** all come from the same model, so switching voice downloads nothing; it's chosen in Settings.
- One-time model download, cached by the service worker. After that, rendering needs no network at all. Track download progress in `Settings.voiceModel` so First run and Settings can show it, and hold articles in `"extracted"` ("Waiting for voice download") until it completes.
- Play-sample buttons use short pre-rendered clips bundled with the app, so they work before the model is downloaded.
- **Measured on a Pixel 8:** 1.17× real time on WebGPU, about 0.15× on the WASM fallback, and the page was killed for memory while loading the High model. Fine on desktop (2.5× real time on a Mac). The app has to stay open while it renders.
- iPhone friends: needs testing on Safari. WebGPU support there is recent; WASM is the safe floor but slower.

Bring-your-own-key cloud voices were dropped (2026-10-28) once the server path existed.

Implement behind an interface so engines can be swapped or mixed:

```ts
interface TtsProvider {
  id: string;
  maxCharsPerRequest: number;
  synthesize(text: string, voice: string, opts?: { speed?: number }):
    Promise<{ audio: ArrayBuffer; mime: string; durationSec?: number;
              wordTimings?: { charStart: number; charEnd: number; start: number; end: number }[] }>;
}
```

**Cost:** a typical article is roughly 5–15k characters, so about 0.5–1.5¢ on the server. On-device costs nothing.

Always render at 1.0× and handle speed at playback (`playbackRate`), so one render serves every speed. Changing voice or quality doesn't re-render existing audio automatically; Settings offers "Re-render queued articles," and multi-select has Re-render.

---

## 7. Playback

**Engine:** a single `<audio>` element playing the article's concatenated file from a blob/object URL.

**Controls (v1)**

- Play/pause, scrub bar, elapsed and remaining time (remaining adjusted for the current speed).
- **Speed:** one global value, 0.8× to 3.0× in 0.1 steps, with presets 1.0/1.25/1.5/1.75/2.0, `preservesPitch = true`. The player picker and Settings edit the same `Settings.speed`, and it persists.
- **Skip:** back/forward by `Settings.skipSeconds` (10, 15, or 30; default 15).
- Previous / next sentence, using the timing map.
- **Long-press** skip back / forward: previous / next article.
- Auto-advance to the next queued article (toggle).
- Resume position saved per article (on `pause`, `visibilitychange`, and every ~5s).
- **While rendering:** play up to `renderedUntilSec`; seeking past it snaps back to it.
- **On finish:** set `playedAt`, then archive or delete per `Settings.keepPlayed` (default archive). Auto-advance continues to the next Up next article that is playable.
- **Chimes:** a short rising chime plays before an article starts from the top, and a falling one when it ends. Resuming partway plays none. With auto-advance, the next article waits for the end chime. The chimes are made in code, play through a second `<audio>` element, and can be turned off (`Settings.chimes`, default on). If a chime can't play, playback carries on without it.

**Lock screen / headphones:** Media Session API with metadata (title, site, artwork in the order article art → site art → rasterized generated cover, all from local blobs so it works offline) and handlers for play, pause, seekbackward, seekforward, seekto, and previoustrack/nexttrack mapped to **previous/next article**. Bluetooth headset buttons route through these handlers. Sentence navigation is in-app only.

**Risk to spike early:** auto-advance swaps `audio.src` while the screen is off. Verify that Chrome on Android keeps playing across that swap when it happens in the background. Fallbacks if it doesn't: pre-load the next article into a second `<audio>` element, or keep the media session alive with a short silent bridge.

---

## 8. Lyrics view (v1.5)

Visual behavior is in DESIGN.md §4; implementation notes:

- Full article text from `contentHtml`, rendered by sentence (`<span data-i>`), with headings and paragraphs kept.
- Three classes: read (`i < current`), current (`aria-current`, wavy underline in the article tint), upcoming.
- Auto-scroll keeps the current sentence about a third of the way down, with eased scrolling (snap with reduced motion).
- Read the position with `requestAnimationFrame` + `audio.currentTime`, since `timeupdate` fires only about 4×/sec and feels laggy.
- Tapping a sentence seeks to it.
- Manual scroll pauses auto-follow and shows "Back to current."
- Stretch: word-level emphasis within the active sentence, from provider timestamps or character-proportional estimates.
- No rAF loop while the page is hidden, to save battery.
- Off by default when a screen reader is detected (can't be detected reliably on the web; default it off and remember the user's choice).

---

## 9. Data model (Dexie)

```ts
type ArticleStatus =
  | "waiting"     // saved offline, not fetched yet
  | "fetching"
  | "extracted"   // text ready, waiting for its turn (or for the voice model) to render
  | "rendering"
  | "ready"
  | "failed";

interface Article {
  id: string;                 // uuid
  source: "url" | "text";
  url?: string;               // absent for pasted text
  canonicalUrl?: string;
  title: string;              // URL until a real title arrives
  byline?: string;
  siteName?: string;
  domain?: string;
  savedAt: number;
  status: ArticleStatus;
  extractionQuality?: "full" | "partial";
  error?: string;             // one-line, user-facing reason when failed
  extractionMethod?: string;  // which ladder step succeeded
  contentHtml?: string;       // for lyrics view
  sentences: { i: number; text: string; start?: number; end?: number }[];
  articleArtKey?: string;     // stored blob, square
  siteArtKey?: string;        // per-domain blob
  coverArtKey?: string;       // rasterized generated cover (Media Session)
  tintSource?: string;        // hex, before per-theme clamping
  audioKey?: string;          // OPFS path or blob key; cleared by "delete audio"
  audioBytes?: number;
  durationSec?: number;       // at 1.0×
  renderProgress?: number;    // 0..1
  renderedUntilSec?: number;
  serverJob?: string;         // server render job, until its chunks are collected
  busyUntil?: number;         // server voice budget spent; retry after this
  ttsProvider?: string;
  voice?: string;
  positionSec: number;        // resume point
  playedAt?: number;          // finished listening
  archivedAt?: number;        // in the Archive section
  deletedAt?: number;         // soft delete; purge after the undo window
  queueOrder: number;         // fractional index for cheap reordering
}

/** A blog the user subscribes to (§4c). */
interface Feed {
  id: string;
  feedUrl: string;            // the RSS/Atom address, after redirects
  siteUrl?: string;
  title: string;              // refreshed by every good check, so a renamed blog follows
  addedAt: number;
  lastCheckedAt?: number;     // set after every attempt, good or bad
  lastError?: string;         // one line; cleared by the next good check
  linkBase?: string | null;   // the blog's moved host (an origin) that post links are rebased onto; null = checked, keep links; unset = not checked yet
}

/** One post from a feed. */
interface FeedItem {
  id: string;                 // stable hash of feedId + (guid or link)
  feedId: string;
  link: string;
  title: string;
  publishedAt?: number;
  firstSeenAt: number;
  seenAt: number | null;      // null until the user has left Subscriptions with it listed
  articleId?: string;         // set once added to the queue
}

interface Settings {
  proxyUrl: string;
  proxySecret: string;
  engineKind: "server" | "device";   // default "server"
  voice: string;              // "af_heart" | "af_bella" | "am_michael"
  voiceQuality: "high" | "standard";
  voiceModel: { status: "none" | "downloading" | "ready" | "error"; bytes?: number; totalBytes?: number };
  speed: number;              // global
  skipSeconds: 10 | 15 | 30;
  autoAdvance: boolean;
  chimes: boolean;            // start and end chimes; default true
  keepPlayed: "archive" | "delete";   // default "archive"
  lyricsOn: boolean;
  lastPlayingArticleId?: string;  // restored on launch (§11a)
}
```

**Undo:** delete sets `deletedAt` and hides the row; the snackbar's Undo clears it. Purge (row + audio + unshared art) after the 6 s window, and on next launch for anything left over.

## 9a. Display states

The queue row state in DESIGN.md comes from these fields. First match wins.

| Display state | Condition |
|---|---|
| Deleted (hidden) | `deletedAt` set |
| Archive section | `archivedAt` set |
| Waiting for connection | `status = "waiting"`, or `"fetching"` while offline |
| Fetching | `status = "fetching"` |
| Failed | `status = "failed"` |
| Queued for audio | `status = "extracted"` (note "Waiting for voice download" if on-device and `voiceModel.status !== "ready"`; "Preparing…" once `serverJob` is set) |
| Waiting for voices | `status = "extracted"` and `busyUntil > now` (server budget spent) |
| Rendering | `status = "rendering"` |
| Playing / In progress | `status = "ready"` and (`id = lastPlayingArticleId` or `positionSec > 0`) |
| Ready | `status = "ready"` |

**Partial** is an overlay, not a separate state: when `extractionQuality = "partial"`, the row shows the Partial glyph and label in place of Ready/Rendering, and tapping it opens the explainer.

---

## 10. Queue & CRUD

- **Queue screen** (home): Up next in `queueOrder`, then an **Archive** section. A bottom tab bar switches between Subscriptions and Up next (DESIGN.md "Navigation"). The tab isn't saved: the app opens on Up next. Row anatomy and states are in DESIGN.md.
- **Gestures:** tap plays immediately; swipe left deletes (undo); swipe right marks played and archives (undo), except on archived rows, which only swipe left; hold a row to drag it into place (Up next), or hold and let go to enter multi-select.
- **Reorder:** hold a row and drag it (Up next only). Drag handles also work in multi-select mode, and on wide screens the row's ⋯ menu has Move up and Move down.
- **Multi-select actions:** delete, move to top, mark played, re-render (e.g. after changing voice), retry extraction.
- **Clear:** "Clear all" in Settings, with confirm. "Clear archive" isn't designed yet; an action on the Archive section header is the natural place.
- **Storage:** Settings shows total size split into audio, voice model, and art, plus "Delete audio for archived articles" (keeps text; re-renders on replay).

---

## 10a. Sharing with friends

Sharing means sharing **the app**, not content. Each person's queue, articles, audio, and settings live only on their own device. The one exception is a reading-list link (§4), which carries a few article links, never audio or text.

- **Distribution:** an invite link like `https://app.example/#invite=<secret>`. Opening it stores the proxy secret locally and starts First run (welcome and install, how to save; plus the voice download for on-device voices). The secret is in the URL fragment, so it's never sent to the server or logged.
- **Invite a friend:** Settings → About → Share sends the same link through the system share sheet.
- **Cost to the owner:** voices, about 1¢ an article, capped at about $10 a month by the daily budget (§6.3). Fetching, the render jobs and their storage stay within Cloudflare's free tiers.
- **Revocation:** rotating the Worker secret cuts off all old links. Per-friend secrets are a possible later feature.
- **Platform notes:**
  - Android: full experience, including the share target.
  - iPhone: the PWA installs from Safari (Share → Add to Home Screen), but iOS doesn't support PWA share targets. iPhone friends save by pasting a URL or with an Apple Shortcut that opens `app/#add=<url>`. On-device TTS speed on iPhone needs testing.
- **APK route:** only relevant if we go native (§12).

---

## 11. Offline

- Service worker precaches the app shell and fonts. The app launches in airplane mode.
- Articles in `ready` state are fully offline (text, audio, timings, art).
- Online voices need a connection to send and collect a job; saved articles wait ("Queued for audio") and continue when it's back. On-device rendering continues offline once the model is downloaded.
- URLs shared while offline are saved as `waiting`, and the pipeline runs when connectivity returns (`online` event + on app open, or the service worker's Background Sync).
- Uploaded PDFs are read offline; only their audio needs a connection.
- UI: one slim banner ("Offline · ready articles still play"), no layout shift. Disable only network actions: Retry, voice download, Invite. Detect with `navigator.onLine` plus failed proxy requests.

---

## 11b. Working while closed

The friend test: share an article, close the app, and it should be ready to play later without keeping the app open. A PWA can't run freely in the background, but the service worker (`src/sw.ts`) gets a few minutes at a time, which is enough because the slow part (rendering) happens on the server:

- **Share target.** Shares go to the service worker (§4), which saves the article and works on it right away, whether or not the page stays open.
- **Background Sync** (`reader-work`). When the page is hidden with work left (text to fetch, articles to send, audio to download), it registers a one-off sync. Chrome runs it once the app is closed (and when the connection comes back). If the server is still rendering when time runs out, the sync fails on purpose so Chrome retries later with backoff.
- **Periodic Background Sync** (`reader-refresh`, about every 3 hours, installed app on Android, if Chrome grants it based on engagement) picks up anything else.

Each run, under a 4-minute budget: extract waiting articles (with linkedom standing in for `DOMParser`, §5), send them to the voice server (`submitPending`, holding a Web Lock so the page and the worker never send the same article twice), then download finished chunks. A service worker can't decode audio, so it stores the MP3 bytes in `serverAudio`; once it has every chunk it tells the server to delete its copy. When the app opens, the page decodes those locally (no network needed) into `renderedChunks`, builds the file, and streams meanwhile (§6.2). The service worker also messages any open page when it finishes, so the page collects right away.

On open, the article in the player is collected first, so tapping one that isn't downloaded yet starts it streaming in a second or two. Chunks are downloaded four at a time.

Limits: none of this works on iPhone (no Background Sync), Chrome decides when syncs and refreshes actually run, and a force-stopped Chrome runs nothing. Each of these falls back to the old behavior: the work finishes on the next open. The next step up would be Web Push (the Worker notifies when a render finishes), which also gives a "Ready to listen" notification.

## 11a. Persistence across restarts

Requirement: hard-close the browser or reboot the phone, reopen the app, and pick up exactly where you left off.

- **Everything is on disk, not in memory.** Articles, queue order, timings, settings, and art live in IndexedDB; audio lives in OPFS. Both survive browser close and device restart.
- **Resume state is saved continuously.** Playback position is written every ~5s, on pause, and on `visibilitychange` / `pagehide`. On reopen, the last-playing article is loaded, paused at its saved position, one tap from playing.
- **Unfinished work resumes.** Any article left in `fetching` or `rendering` restarts its pipeline on launch. Rendered chunks are saved as they finish, so a re-render picks up from the last completed chunk. An interrupted voice-model download resumes too.
- **Protection against eviction.** Call `navigator.storage.persist()` on first launch. Settings shows whether it was granted ("Storage is protected").
- **What actually wipes data:** clearing Chrome's site data for the app, or (possibly) uninstalling the PWA.
- **Export / Import:** "Export queue" downloads a small JSON of URLs (and pasted text), titles, order, positions, and archive state; "Import" restores it. Audio isn't included and re-renders.

---

## 12. Alternatives considered

**B. Native Android app (Capacitor wrapper around the same web code)**
- Pros: no proxy needed (native HTTP has no CORS), fetches from the phone's own IP (fewer bot blocks), real background work (render while the app is closed), and access to Android's system TTS as a free offline voice with word-range callbacks. Sharing can show a "Saved" toast without opening the app.
- Cons: Android Studio/Gradle toolchain, sideloaded APK updates, slower iteration.
- **Plan:** start as a PWA. Most of the code carries over if we move to Capacitor later.
- **Main trigger for switching:** if on-device Kokoro is too slow in the browser, a native app can render in the background, and it can fall back to Android's built-in system voices. The cost is losing easy sharing with iPhone friends.

**Web Speech API (live synthesis)**
- Rejected for the primary path: unreliable when the screen is off, no boundary events on Android Chrome (so no highlighting), and nothing to cache for offline.

---

## 13. Worker API

All requests need the header `X-App-Secret: <secret>`. CORS is restricted to the app's origin.

```
GET  /fetch?url=<encoded>&profile=default|nocookie|referrer|amp
  → 200 the page's HTML streamed through, or a PDF's bytes (application/pdf, or octet-stream from a .pdf path; up to 30 MB)
       headers X-Final-Url, X-Upstream-Status, X-Upstream-Content-Type
  → 4xx/5xx { error }

GET  /asset?url=<encoded>
  → 200 image bytes (size-capped, image/* only)

GET  /archive?url=<encoded>
  → 200 { wayback?: string, archiveToday?: string }   // snapshot URLs, if any

POST /render   { voice, chunks: [{ i, text }] }       // voice: af_heart | af_bella | am_michael
  → 202 { job, chunks }
  → 429 { error: "busy", retryAt }                  // day's voice budget spent
  → 400 { error }                                   // bad voice, empty/too long chunk, >400 chunks
GET    /render/:job      → 200 { status, ready: [{ i, sec }] }   // status from the Workflow
GET    /render/:job/:i   → 200 audio/mpeg (one chunk, header frame stripped) + X-Chunk-Seconds
DELETE /render/:job      → 204 (deletes the chunks; an R2 lifecycle rule expires leftovers after 7 days)
```

Only rendered audio is stored, and only until the app downloads it. No logging of URLs or content beyond Cloudflare's defaults.

---

## 14. Build phases

**Phase 0: spikes (do first, they decide the architecture)**
- [ ] **On-device TTS speed (highest priority):** Kokoro in Chrome on the Pixel 8 (WebGPU and WASM, both quality levels) and in Safari on an iPhone. Measure render time vs. audio length. This decides PWA vs. native.
- [ ] Voice bake-off: Kokoro voices vs. 1–2 cloud voices, listened to on the phone at 1.0× and 1.5×.
- [ ] Background playback test on the Pixel 8: screen off, lock-screen controls, and `src` swap for auto-advance.
- [ ] Share-target round trip from Chrome and from a few apps, including what each sends in `url` vs. `text`.

**Phase 1: MVP (listen to one article)**
- [ ] Worker `/fetch` and `/asset`, deployed
- [ ] Paste URL → Readability → text prep → chunked on-device render → concatenated file
- [ ] Player with play/pause, scrub, speed, ±skip, resume position
- [ ] Dexie storage, offline app shell and fonts
- [ ] Persistence: continuous position saves, resume last-playing on launch, resume interrupted renders, `storage.persist()` (§11a)

**Phase 2: the actual product**
- [ ] Share target (URL and text), Add sheet (Link and Text), arrival state
- [ ] Queue screen with all display states, mini player, Now Playing, auto-advance, Media Session
- [ ] Artwork storage, generated covers, article tint
- [ ] Swipe gestures, multi-select CRUD, undo, Archive, clear all
- [ ] Progressive playback (start before full render, buffered scrubber)
- [ ] First run (install, voice download, how to save), Settings
- [ ] Invite links, BYO-key setting + Worker `/tts` passthrough

**Phase 3: extraction ladder**
- [ ] Quality scoring
- [ ] Steps 2–6, recording the method used; Partial flag and explainer; "Paste the full text" replacement
- [ ] Test corpus: ~20 real URLs (open, soft-paywalled, hard-paywalled, JS-heavy) with expected outcomes

**Phase 4: lyrics view & polish**
- [ ] Lyrics view with tap-to-seek, Back to current
- [ ] Per-domain overrides, storage management
- [ ] Optional word-level emphasis

**Later**
- [ ] Feed inbox follow-ups: OPML import, JSON Feed. (The inbox itself is built, §4c.)
- [ ] Saving from another device (relay inbox)

---

## 15. Open questions

1. ~~Discovery~~ **Decided:** a pull-only feed inbox (§4c): subscribe to blogs, new posts wait in Subscriptions, nothing is added or rendered until the user taps Add. No recommendations.
2. **Voice quality bar:** if on-device Kokoro is good but noticeably below the best cloud voices, is that acceptable as the default for you too, or would you personally use BYO-key?
2a. **Friends' phones:** roughly how many are on iPhone? That determines how much the PWA route matters compared with a native Android app.
3. ~~Voice preference~~ **Decided:** one global voice, chosen in Settings.
4. ~~Finished articles~~ **Decided:** archive by default; delete is a setting.
5. ~~Reading mode~~ **Decided:** out of scope for v1.
6. **Paywall ladder in v1**, or ship listening first with plain extraction and add the ladder in Phase 3? (The current plan is the latter. Partial detection and "Paste the full text" can still ship in Phase 2 with only step 1 and the quality check.)
7. **Name.** Blocks the app icon, wordmark, and share-target label ("Read-Aloud" is the placeholder).
