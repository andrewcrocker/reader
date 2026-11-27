# Voice cache

A spike, behind `VOICE_CACHE` (off by default). Design discussion: [issue #4](https://github.com/andrewcrocker/reader/issues/4). The short rules are in [SPEC.md §6.4](SPEC.md).

Make each chunk of audio once and let everyone reuse it. A repeat costs nothing and skips the voice host's queue.

## How it works

- **Key.** `cache/<voice>/<sha256>.mp3`. The hash covers `VOICE_CACHE_VERSION`, the voice and the chunk's exact text (`worker/src/voiceCache.ts`). The Worker doesn't normalize: the app already does (`normalizeForSpeech`), and what's hashed is what the voice host is sent. Bump the version by hand when the host's model (`hexgrad/Kokoro-82M` is unpinned), the request settings or the MP3 post-processing change. The `<voice>/` folder lets you purge one voice with a lifecycle rule on `cache/af_bella/`.
- **Storage.** The existing `AUDIO` bucket, under `cache/`. Its 7-day rule is scoped to `jobs/`, so it never touches `cache/`, and no new binding is needed. `cache/` gets its own 180-day rule. R2 expires by age only, so entries older than 170 days count as misses and are re-rendered, which refreshes them.
- **App.** For a URL article it adds `cacheable: true` to `POST /render` (`isCacheable` in `src/tts/server.ts`, used by `submitPending`). Pasted text and uploaded files never send it, and a missing flag means false.
- **`POST /render`** (flag on, cacheable). The quota counter (a Durable Object) looks every chunk up, then reserves the daily budget for the misses only. A hit costs no characters, and an all-hit article is accepted even when the day's budget is spent. The manifest becomes `{ parts, chunks: { i: key }, secs: { i: sec } }`, listing hits with the length stored on the audio. Only misses go to the Workflow (30 a part, as before); an all-hit job has none.
- **`GET`.** `/render/:job` lists hits as `ready` with their stored `sec`, and reports `complete` at once if there are no parts. `/render/:job/:i` reads the job's own chunk, else the cache object the manifest names. `DELETE` removes `jobs/<job>/` only. Hits aren't copied into `jobs/`; that would cost a read and a write per chunk for nothing.
- **Workflow.** A miss is rendered as before, written to `jobs/`, and also to its cache key with `sec` in the metadata (best effort). The Workflow never touches the budget, so a retried step can't charge it twice.
- **Flag off, or not cacheable:** the old path: same quota call, manifest and Workflow parameters, and no access to `cache/` (tested).
- **Numbers.** Each cache `/render` logs `{event:"voice-cache", hits, misses, charsSaved, charsCharged, bytesSaved}`: counts only, to size the cache from real use.

## Cost

- Voice host: $0.99 per million characters, about 1¢ for a typical article. A hit saves that and its share of the daily cap.
- Storage: $0.015 per GB-month, 10 GB free, no egress fees. A 30-minute article is about 15 to 30 MB, so 1,000 cached articles are 15 to 30 GB, roughly $0.08 to $0.30 a month beyond the free tier. Keeping one for 180 days costs under 0.3¢, so one hit pays for it. The real bitrate is unmeasured; `bytesSaved` will show it.
- Operations (1M class A and 10M class B free a month): a miss is one lookup and two writes; a hit one lookup, plus a few reads when downloaded. Even 6,000 chunks a day stays well inside.

## Privacy

- **Cached:** audio of articles fetched from a URL, under a hash. No URL, title, person or text is stored with it. The server now holds audio of what people listened to, not who. SPEC names this next to "no server state".
- **Not cached:** pasted text, uploaded files, and a URL article whose text was pasted over. One gap: a page behind a secret link is fetched like any other and can be cached.
- Lookups need the invite secret. There is no endpoint that says whether a hash exists. The only signal is that chunks you sent are ready at once, which tells an invited user the text was rendered before.

## Free-plan limits (Cloudflare docs, checked 2026-11)

- **Subrequests.** A call to R2, KV or D1 is a subrequest. Free allows 50 to the outside and 1,000 to Cloudflare services per invocation, so R2 calls are on the 1,000 side and 400 lookups fit the count. [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Workflows](https://developers.cloudflare.com/workflows/reference/limits/) (same two numbers, 10 ms CPU per step). `PART_SIZE` stays 30: it comes from the 50 outside calls, one per miss.
- **CPU.** 10 ms per request on Free. Waiting on R2 doesn't count, but 400 hashes and 400 binding calls may not fit, and a request waits on six connections at a time. I couldn't measure it (`wrangler dev` doesn't enforce Free CPU), so `/render` makes one call and the counter does the lookups. [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/) list 30 s of CPU per invocation, but the same page says they "have the same per invocation CPU limits as any Workers do", which is unclear for Free. Watch for CPU errors in the first days.
- **R2.** [Pricing](https://developers.cloudflare.com/r2/pricing/): get and head are class B, put and list class A. [Limits](https://developers.cloudflare.com/r2/platform/limits/): one write a second per key.

## Streaming

**In the app, now.** Hits are ready the moment the job exists. The collector downloads them in index order, four at a time, storing each as it arrives, so progressive playback starts after the first group (tested). The app still downloads, decodes and re-encodes every chunk, so the win is skipping the voice host's queue (3 to 12 s a chunk) and the budget, not the local work.

**Public `listen.mp3`: NOT BUILT, pending the copyright decision in #4.** There is no public route. If one is built:

- It serves audio that already exists and never starts a render, so a public link can't spend the voice budget. It must not offer a "does this hash exist" check.
- Prefer one assembled `article.mp3` over streaming N chunks. Streaming 400 objects means 400 sequential reads, a byte-offset index to answer `Range`, and no easy edge caching. Assemble the file once, when a public listen is first needed (from the cache, or the sharer's file), store it, and let R2 answer `Content-Length` and `Range`, which iOS and Safari want.
- Public listens must not depend on cache entries that can expire. Copy the audio into the list's own storage when it's published or first played, or keep the entries it uses.

## Owner actions

1. Decide whether to store audio at all (see Privacy).
2. Add the rule: `wrangler r2 bucket lifecycle add reader-audio expire-cache cache/ --expire-days 180`. Without it nothing in `cache/` is ever deleted. If you pick fewer than 180 days, lower `CACHE_TRUST_MS`.
3. Set `VOICE_CACHE = "on"` in `worker/wrangler.toml` and deploy. `"off"` stops new use at once; jobs already made keep working.
4. Watch the `voice-cache` log lines and CPU errors, then set the budget.

## Known gaps

- **Single flight.** Two first renders of the same chunk at once both pay, and the same text twice in one article is rendered twice. A per-key lock in the counter would fix it.
- **Retries.** A retried Workflow step can ask the voice host twice for a chunk; the budget isn't charged twice, so DeepInfra's own limit is the backstop, as today.
- **A vanished entry** (deleted between the lookup and the download) makes that chunk 404 for the app. The 170-day trust makes it very unlikely.
- **Counter CPU** on Free is unmeasured (above).
