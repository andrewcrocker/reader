# Handoff: hybrid design implementation

Branch `design-wip`. Implements the "Read-Aloud Reader" canvas, page **Hybrid (final)**, per `spec/DESIGN.md` and `spec/SPEC.md`. Delete this file when the branch lands on `main`.

## State

All seven steps from the previous handoff are built. `npm run typecheck`, `npm test` (54 passing), and `npm run build` are clean. Every screen was checked in the dev server at 412 px (light and dark where it matters) against seeded data covering each row state.

| Area | Where |
|---|---|
| Queue actions (soft delete + undo + purge, archive, move to top, reorder, clear, archived-audio delete, export/import) | `src/queue/actions.ts` |
| UI state (overlays on the history stack so Android back works; one 6 s snackbar) | `src/app/ui.ts` |
| Live data, online state | `src/app/data.tsx` |
| Player: one `<audio>`, speed, skip, sentence and article nav, auto-advance, on-finish archive/delete, position saves, Media Session (art or rasterized cover), tint crossfade | `src/player/` |
| Screens | `src/screens/` (Queue, QueueRow, MiniPlayer, NowPlaying, Lyrics, Transport, sheets, Settings, FirstRun) |
| Share target, `#invite=`, `#add=` | `src/app/share.ts`, `src/App.tsx`, `vite.config.ts` |
| Install prompt | `src/app/install.ts` |

## Not verified

- Real device: Pixel 8 share sheet round trip, background playback across auto-advance, lock-screen art, PWA install prompt.
- A real fetch: the local Worker wasn't running, so link adds failed in testing (as they should without it).

## Gaps (spec says yes, not built)

- Progressive playback works in browsers with MediaSource MP3 support (Chrome, including Android). Elsewhere (iPhone Safari) play still waits for the full render. On-device rendering stops when the app is backgrounded or the screen is off; server rendering doesn't, but collecting chunks does.

- Server voices (default since 2026-10-28) are built and tested locally end to end: send, render with the app closed, collect on reopen, busy banner. Deployed 2026-10-28 (README "Deploy") and smoke-tested against production; not yet tried on the Pixel. Per-invite allowances aren't possible until invites get their own secrets; only the global daily cap exists.
- Extraction ladder steps 2–5 (SPEC Phase 3). "Clear archive" is undesigned and not built.
- Shared-text status row says "another app": Web Share Target doesn't tell us which app.
