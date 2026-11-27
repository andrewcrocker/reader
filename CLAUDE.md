# Notes for Claude

Reader is a "listen later" PWA: React + Vite, Dexie (IndexedDB), a service worker (`src/sw.ts`), and a Cloudflare Worker (`worker/`). Read [README.md](README.md) for how it fits together, [spec/SPEC.md](spec/SPEC.md) for behavior and [spec/DESIGN.md](spec/DESIGN.md) for design. [CONTRIBUTING.md](CONTRIBUTING.md) has the workflow.

Most people working here are on a fork and send changes back to the original repo by pull request. Keep those PRs clean:

## Never put these in a PR

- **Deployment settings that belong to the original app.** Leave these as they are in any PR:
  - `.env.production` (`VITE_PROXY_URL` is the original app's Worker)
  - `ALLOWED_ORIGINS` in `worker/wrangler.toml`
  - the Pages project name in `deploy:app` in `package.json`

  A fork that runs its own copy changes them, but only in the fork. Keep those edits on the fork's own branch or commit, never on a PR branch. If a PR branch picks one up, take it out before opening the PR.
- **Secrets.** Never commit `worker/.dev.vars`, API keys or invite secrets, and never put a secret in a `VITE_` variable: the built JS is public.
- **Unrelated reformatting.** There's no formatter config; only touch lines you're changing.

## Before opening a PR

- Run `npm run typecheck` and `npm test`; CI runs both.
- Add or update tests next to the code you changed (`*.test.ts`).
- Update `spec/SPEC.md` or `spec/DESIGN.md` when behavior or design changes. They're written in plain, short sentences; match that.
- Keep each PR to one change.

## Leave to the maintainer

- Pushing to the original repo's `main` and deploying (`npm run deploy:app`, `npm run deploy:worker`). Merged PRs go live when the maintainer deploys.
- Anything that costs money or changes the shared voice budget (`DAILY_CHAR_CAP`, the voice host).

## Things that are easy to get wrong

- The Worker runs on the Cloudflare free plan (about 10 ms of CPU per request). Parsing pages and PDFs stays on the device or in the service worker, not the Worker.
- Code in `src/pipeline/` that the service worker imports (`background.ts`, `serverSync.ts`, `extract.ts`, `textprep.ts`, `pdf.ts`, `dom.ts`) can't use DOM-only APIs (`DOMParser`, `document`, `window`, audio decoding). Use `parseHtml` from `dom.ts` for HTML.
- The service worker builds as a classic script (IIFE); it can't use `import()`.
