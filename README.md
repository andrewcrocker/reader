![Reader: articles, read aloud](public/og.png)

# Reader

A "listen later" app. Share an article from your phone (or paste a link or text); it's read aloud by a natural voice (Kokoro-82M) and saved on the phone, so it plays later on a walk, a commute, or offline, with a read-along view that follows the audio sentence by sentence.

- **Live:** https://read-aloud-c1w.pages.dev (invite-only; see [Deploy](#deploy))
- **Specs:** engineering in [spec/SPEC.md](spec/SPEC.md), design in [spec/DESIGN.md](spec/DESIGN.md)
- **Stack:** React + Vite PWA, Dexie (IndexedDB), a Cloudflare Worker for fetching pages and making voices, Cloudflare Pages for the app

**How voices work.** By default the Worker renders them: the app sends an article's text once, a Cloudflare Workflow sends it to a hosted Kokoro API (DeepInfra) in parts, and the audio waits in R2 until the app collects it, so articles finish even with the app closed. It costs about 1¢ per article, capped at about $10 a month. On-device Kokoro (WebGPU/WASM) is still a Settings choice; it works well on desktop but struggled on a Pixel 8 (memory, background limits, heat), which is why the server is the default.

**Built:** the full design (queue, Now Playing, read-along, sheets, Settings, First run, wide layout), server voices with a daily budget and email alerts, share target, invite links, offline playback, progressive playback while audio renders, link previews.

## Run it locally

You need Node 22+. Install once:

```bash
npm install
```

Then, in two terminals:

```bash
npm run dev:worker
```

```bash
npm run dev
```

- App: http://localhost:5173
- On-device TTS benchmark (dev tool): http://localhost:5173/spike
- The Worker (fetch proxy and server voices) runs at http://localhost:8787. The Vite dev server forwards `/api/*` to it, so the browser only talks to port 5173. Locally, its R2 bucket, Workflow and Durable Object are simulated by `wrangler dev`.
- Server voices need `DEEPINFRA_API_KEY` in `worker/.dev.vars`; budget alert emails need `RESEND_API_KEY` and `ALERT_EMAIL` (the Resend account's own address). Without the voice key, set Settings → Voice → Engine to "On this device".
- The dev secret is `dev-secret`, in `worker/.dev.vars` (git-ignored, copied from `worker/.dev.vars.example`). Locally you never enter it: the `/api` proxy in both `npm run dev` and `npm run preview` reads it from that file and attaches it, so the Settings secret field can stay blank.

Tests and type checks:

```bash
npm test
```

```bash
npm run typecheck
```

To try the production build locally, including the service worker and offline app shell (keep `npm run dev:worker` running for fetching):

```bash
npm run build && npm run preview
```

That serves http://localhost:4173.

## Test on the Pixel 8

WebGPU, service workers, OPFS and multi-threaded WASM all need a **secure context**. `http://<your-LAN-IP>:5173` is not one, so use one of these options.

**Option A: USB and `adb reverse` (recommended).** This needs USB debugging on the phone and `adb` on the Mac (`brew install android-platform-tools`).

```bash
adb reverse tcp:5173 tcp:5173
```

Then open `http://localhost:5173` (or `/spike`) in Chrome on the phone. On the phone that address is `localhost`, so it counts as secure. You can watch logs from `chrome://inspect` on the Mac.

**Option B: no cable, temporary tunnel.** This exposes your dev server at a random public `trycloudflare.com` URL for as long as the command runs. It needs no account.

```bash
brew install cloudflared
```

```bash
cloudflared tunnel --url http://localhost:5173
```

Open the printed `https://….trycloudflare.com` on the phone. To test install and the share sheet, tunnel the production build instead (`npm run build && npm run preview`, then `cloudflared tunnel --url http://localhost:4173`): the dev server has no service worker or manifest.

### Running the on-device spike

Only relevant to on-device voices. Measured on a Pixel 8: 1.17× real time on WebGPU, about 0.15× on WASM, and the page was killed for memory while loading the High model.

1. Open `/spike`. Leave **Backend** on **Auto**. It tries WebGPU first and falls back to WASM if WebGPU is missing, fails to load, or produces bad audio.
2. Pick a voice and press **Run**. The first run downloads the model: about 310 MB for WebGPU fp32, or about 90 MB for WASM q8. Later runs load from the browser cache.
3. Read off the backend, model load time, render time, audio duration, and **real-time factor** (render time ÷ audio length; below 1.0 is faster than playback).
4. Listen at 1×, 1.5× and 2×. **Download WAV** saves the file for side-by-side listening.
5. To compare backends, run again with **WebGPU only** and **WASM only**. To compare voices, change the voice; the loaded model is reused.
6. **Copy JSON** copies every run (including the user agent) so you can paste the results back to me.

Keep the screen on while it renders (the page requests a wake lock). Android throttles background tabs.

## Deploy

Deployed 2026-10-28:

- App (Pages project `read-aloud`): https://read-aloud-c1w.pages.dev
- Worker `reader-proxy`: https://reader-proxy.andrew-crocker-c26.workers.dev
- Production secret: `worker/.prod.vars` (git-ignored). The invite link is `https://read-aloud-c1w.pages.dev/#invite=<APP_SECRET>`.

To ship changes: `npm run deploy:worker` and `npm run deploy:app`. Secrets: `./scripts/put-secrets.sh`.

How it was set up the first time:

1. Log in to Cloudflare:

   ```bash
   npx wrangler login
   ```

2. Generate a long random secret and store it on the Worker:

   ```bash
   openssl rand -base64 32
   ```

   ```bash
   npx wrangler secret put APP_SECRET --config worker/wrangler.toml
   ```

   Then the voice and alert secrets, one at a time (`DEEPINFRA_API_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL`):

   ```bash
   npx wrangler secret put DEEPINFRA_API_KEY --config worker/wrangler.toml
   ```

   Create the audio bucket and its 7-day expiry for jobs nobody collected:

   ```bash
   npx wrangler r2 bucket create reader-audio
   ```

   ```bash
   npx wrangler r2 bucket lifecycle add reader-audio expire-jobs jobs/ --expire-days 7
   ```

3. Edit `ALLOWED_ORIGINS` in [worker/wrangler.toml](worker/wrangler.toml) to your app's origin (for example `https://reader.pages.dev`). Then deploy the Worker:

   ```bash
   npm run deploy:worker
   ```

   Note the printed `https://reader-proxy.<you>.workers.dev` URL.

4. Point the production build at the Worker. Create `.env.production` with one line:

   ```
   VITE_PROXY_URL=https://reader-proxy.<you>.workers.dev
   ```

   Don't put the secret in it, because the built JS is public. People get it through the invite link (`#invite=<secret>`), which the app saves on the device; Settings → Invite a friend shares it.

5. Create the Pages project once (`--force` makes a classic Pages project; without it Wrangler tries to auto-configure a Worker and fails on this repo), then deploy:

   ```bash
   npx wrangler pages project create read-aloud --production-branch main --force
   ```

   ```bash
   npm run deploy:app
   ```

`public/_headers` sets the cross-origin isolation headers on Pages. Multi-threaded WASM needs them.

## How it fits together

| Piece | Where |
|---|---|
| Fetch proxy (Hono on Workers): auth, origin check, SSRF guard, 5 MB cap, 15 s timeout | [worker/src/index.ts](worker/src/index.ts) |
| Server voices: `/render` routes, voice allowlist, daily budget, alert email, MP3 header stripping | [worker/src/render.ts](worker/src/render.ts) |
| Render Workflow (one step per chunk) and the budget counter (Durable Object) | [worker/src/jobs.ts](worker/src/jobs.ts) |
| App side of server voices: send once, collect chunks, build the file | [src/tts/server.ts](src/tts/server.ts), [src/pipeline/serverRender.ts](src/pipeline/serverRender.ts) |
| Dexie schema, settings | [src/db.ts](src/db.ts) |
| Readability extraction via the proxy | [src/pipeline/extract.ts](src/pipeline/extract.ts) |
| Text prep (§6.1): cleanup, intro, normalization, sentence split, chunking | [src/pipeline/textprep.ts](src/pipeline/textprep.ts) |
| Kokoro in a Web Worker, WebGPU→WASM fallback with output sanity check | [src/tts/kokoro.worker.ts](src/tts/kokoro.worker.ts), [src/tts/engine.ts](src/tts/engine.ts) |
| Chunked render with per-chunk persistence, then concatenate + MP3 encode + timings | [src/pipeline/render.ts](src/pipeline/render.ts), [src/audio/](src/audio) |
| Pipeline loops: fetch and render side by side, resume on launch / `online` / return to the app | [src/pipeline/runner.ts](src/pipeline/runner.ts) |
| Player: one `<audio>`, streaming while rendering, speed, skip, sentence nav, auto-advance, Media Session, article tint | [src/player/](src/player) |
| Screens: Queue, Now Playing, read-along, sheets, Settings, First run, invite screen | [src/screens/](src/screens) |
| UI state on the history stack (Android back), snackbar, share target, invites, app updates | [src/app/](src/app) |
| On-device TTS benchmark | [src/pages/Spike.tsx](src/pages/Spike.tsx) |

### Where this differs from the spec

- **`/fetch` streams the raw HTML** instead of returning `{ finalUrl, status, contentType, html }` JSON. Metadata comes back in the `X-Final-Url`, `X-Upstream-Status` and `X-Upstream-Content-Type` headers. Decoding and re-encoding a multi-megabyte page as JSON could blow the free plan's ~10 ms CPU budget. A passthrough stream costs almost nothing.
- **The TTS provider interface returns PCM**, not an encoded `ArrayBuffer` plus MIME type. On-device output is raw 24 kHz float audio. Encoding happens once per article (one continuous MP3 at 48 kbps), which avoids encoder padding gaps between chunks.
- **Model files live in OPFS, not the service worker cache.** The app downloads the model into OPFS (`models/`) and waits for the write to finish *before* loading it, then hands transformers.js an OPFS-backed cache. That works around two real problems found while testing:
  1. Chrome's Cache API refuses single entries above roughly 10% of the origin's quota. The fp32 WebGPU model is 325 MB, and the write failed with `UnknownError` on a 2.8 GB-quota origin.
  2. transformers.js caches the model in a background write after loading, and closing the app cuts that write off.

  Voice files (about 0.5 MB each) are cached by kokoro-js in the Cache API (`kokoro-voices`). The ONNX Runtime WASM is self-hosted under `/ort/` and runtime-cached by the service worker.
- **Sentence timings inside a multi-sentence chunk are estimated** from each sentence's share of the characters. Timings at chunk boundaries are exact.
- **Server render jobs are split into parts of 30 chunks.** On the Workers free plan one Workflow run may make only 50 outside requests, one per chunk.
