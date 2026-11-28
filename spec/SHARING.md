# Later: public pages

Status: **not built.** Nothing here is in this PR. Sharing a list today is a `#list=` link with no server (SPEC §4 "Sharing a reading list"). This page is only a note on what a public page would take, so the idea isn't lost.

## Why it might be wanted

A `#list=` link opens in Reader, so it works for people who have the app and nothing else. Two things it can't do:

- **A real link preview.** A chat app builds its preview from a web page's tags, and the link's fragment never reaches a server. So the link looks like any other link, and the card is sent as an attached image instead.
- **People without Reader.** Anyone who doesn't have the app (or an invite) gets nothing useful from the link.

Both need a page on a server: `GET /l/<id>` with the list and its card, public, no secret.

## What it would take

- **Stored snapshots.** The list and card are uploaded when the user shares, and kept (for example in R2). The link points at that copy, so it can't change afterwards. Today nothing is uploaded.
- **Unpublish and expiry.** A way to delete a list (a delete token kept on the device, or an operator route behind the app secret), and an expiry, so a mistaken share isn't permanent.
- **A per-day upload cap.** Anyone with an invite could publish otherwise. The voice budget's quota Durable Object is the pattern to follow.
- **Where "Get Reader" points.** The app is invite-only, so there is no public landing page. The owner would set one, or build a request-an-invite page.
- **A copyright stance for public audio.** The page could link out to the original articles. Playing their audio publicly is closer to republishing, and is the owner's call.
- **A change to SPEC §1.** "Everything lives on the device" has one exception today (audio waiting in R2). A public page is a second, larger one.

## Listening

Reader's value is audio, and a recipient with no invite can't make any. A shared voice cache would let public pages play audio that already exists without spending the voice budget: see issue #4, "Cache voices so each article is converted once and shared by everyone".
