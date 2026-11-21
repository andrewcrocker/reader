# Contributing

Thanks for helping. Reader is a small personal project, so the process is light.

## Before you start

For anything bigger than a small fix, open an issue first and say what you want to change. That saves you building something that doesn't fit the app. The specs are a good place to check the intent: [spec/SPEC.md](spec/SPEC.md) for engineering and [spec/DESIGN.md](spec/DESIGN.md) for design.

## Set up

Follow [Run it locally](README.md#run-it-locally) in the README. In short: Node 22+, `npm install`, copy `worker/.dev.vars.example` to `worker/.dev.vars`, then run `npm run dev:worker` and `npm run dev` in two terminals.

You don't need any API keys to work on most of the app. Without `DEEPINFRA_API_KEY`, articles are fetched and saved but stay at "Queued for audio". If you're working on voices, make your own DeepInfra key and put it in `worker/.dev.vars`. Never commit that file or any key.

## Making a change

1. Fork the repo and make a branch from `main`.
2. Keep each PR to one change. Small PRs get reviewed faster.
3. Add or update tests in the same area when you change behavior (`*.test.ts` files sit next to the code).
4. Before you open the PR, run:

   ```bash
   npm run typecheck
   ```

   ```bash
   npm test
   ```

   CI runs both on every PR.
5. For anything visible, try it in the app and add a screenshot to the PR. If it touches playback, offline or the share sheet, test it on a phone too (see [Test on the Pixel 8](README.md#test-on-the-pixel-8)).

## Style

- TypeScript, React function components, no new UI libraries without asking.
- Match the code around you. There's no formatter config, so don't reformat files you aren't changing.
- Write commit messages in the imperative, describing what the change does ("Fall back to archived copies when a page fails to load").
- Keep UI text plain and short, like the rest of the app.

## After it's merged

Deploys are done by hand, so a merged PR goes live the next time the app is deployed.

By contributing, you agree that your work is licensed under the project's [MIT License](LICENSE).
