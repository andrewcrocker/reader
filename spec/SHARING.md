# Shared reading lists: design notes (spike)

Status: a working spike, built on the Subscriptions and tab bar branch. The behavior is in SPEC.md §10b and DESIGN.md §12 and §12a; this page is the reasoning and the loose ends.

## Concept and flow

You love (heart) the things you enjoyed and want to revisit. Loving is not archiving: Archive means "done", a heart means "worth coming back to". The **Saved** tab (the old Archive tab) lists loved articles first, then the archive.

To share: **Saved → Share**. Pick **This week** (loved since Monday: the calendar week, Monday 00:00 to Sunday 23:59 in your local time, so it counts up through the week and starts again from zero on Monday) or **All time**, optionally add your name and a one-line note, check the preview, tap **Share**. The app draws a 1200 × 630 card on a canvas, uploads it with the list, and hands the link to the system share sheet (or copies it). Whoever gets the link sees a **preview card** in their chat, and a **public page** where they can open every article. If they already use Reader, each item has "Open in Reader", which adds it to their queue through the existing `#add=` link.

## The card

Drawn in the app (`src/share/card.ts`), so the Worker needs no image rendering. It's meant to read as **a playlist you can press play on**, so the right half is Reader's own player (the mini player's dark surface, Now Playing's tile, scrubber and round accent play button), not a list of titles.

- **Left, on the app's teal (`accent`):** the Reader mark, the eyebrow (a heart, then "THIS WEEK · 6 ARTICLES"), and the headline in Literata, as large as fits (up to about 92 px). A hyphenated word like "all-time" stays whole when the line is wide enough, and a long name drops a size rather than break mid-word.
- **Right, the player:** *now playing* is the first article (its tile: the site's art when the app has it, else its tint with initials; its title and domain). Under it a scrubber at the very start, "0:00" and the article's length ("25:00"). Then the big round play button, flanked by the app's skip glyphs, with **"Listen on Reader"** as its label, so the call to action is part of the player instead of a separate pill. Below a hairline, the **next two to four items** as compact rows (tile, title, domain, minutes; as many as fit, fewer when titles wrap), and a footer: **"+N more · 2 h 17 m total"** (the whole list's listening time, in the app's duration style).
- **Small sizes:** at 400 px wide (iMessage, Slack, Discord, X) the headline and the play button are the two things that still read; the rows and times are detail for the full size. With one article the footer is dropped (the clock is the total).

About 250 KB, because the app writes the PNG itself with a row filter (the browser's encoder gives 530 KB for the same pixels). The Worker takes up to 1 MB.

## Why snapshots

A list is frozen when you publish it. That keeps the server dumb (two files in a bucket, no database, no sync, nothing to update), keeps the preview image and the page in agreement forever, and means a recipient never sees something you didn't mean to share (for example a heart added later, or a title you've since deleted). It also fits the app's model: the app is the source of truth, the server holds a copy you chose to put there. The cost is that a list can't be edited. To update, publish again.

## Privacy model

- **Public by link, unlisted.** Anyone with the link can open the page and the card. The id is 10 random characters (50 bits), the page says `noindex`, and nothing links to it, but it is not secret: a forwarded link works for everyone.
- **Opt-in per list.** Nothing leaves the device until you tap Share. The upload is the list's titles, links, domains, bylines, minutes and colors, your optional name and note, and the card. Not your queue, playback, listening position or settings.
- **No unpublish yet.** Once published, a list stays. This is the biggest gap (see open questions).
- **The public page never carries the app secret.** The call to action points to `PUBLIC_CTA_URL`, not the invite link. Outbound links use `rel="noopener nofollow ugc"` and a referrer policy that sends our origin but not the list's path.

## The server-state trade-off

SPEC §1 lists accounts and sync as non-goals ("everything lives on the device"), with one exception (rendered audio waits in R2 for at most 7 days). Sharing is a second exception, and it is a bigger one: it is public, long-lived content, and the Worker, which was a stateless proxy, now stores user data and serves HTML to strangers. We contain it:

- **Separate bucket** (`reader-lists`, binding `LISTS`, no lifecycle rule), so the audio bucket's 7-day expiry can't eat it and a bug there can't touch lists.
- **Only publishing needs the secret.** Reading a list (`GET /l/:id`, `/l/:id/card.png`) is the only unauthenticated surface, matched by an exact method and path; every other route, and near-misses of those two, still need the secret and an allowed origin (tested).
- **Validated and capped on write:** at most 50 items, capped strings, `http(s)` links only (no credentials), a PNG under 1 MB. The page escapes everything, has no script at all, and a CSP of `default-src 'none'` with one nonced stylesheet.
- **No accounts, no user table.** Authorship is "someone holding the invite secret".

## Virality hooks

- **The card** is the main one: a distinct teal that reads as Reader in a feed, and a headline that makes the list feel curated by a person ("Zach's reading this week").
- **The page** is calm and fast (no scripts, light and dark), shows who and why, and ends in a "Get Reader" button (twice: header and footer). Where it points is an owner decision (`PUBLIC_CTA_URL`). It opens with the same player as the card, so whoever taps the preview lands on what they saw: the first article, a play button and the total time, then the list as numbered rows with minutes.
- **The play button is honest.** Recipients can't stream audio (see below), so the page's play button, "Listen on Reader", is a link, not playback: it goes to `<APP_URL>/#add=<first article>` ("Opens in Reader", the same link as each row's "Open in Reader"), or to the "Get Reader" page when there's no app URL or the first article has no usable link ("Get Reader to listen"), and is left out if neither exists. The scrubber and clock are only an echo of the card; there is no script, audio element or button on the page.
- **"Open in Reader"** per item converts existing users in one tap.
- **Listening for recipients.** This is the weak spot: Reader's value is audio, and a recipient with no invite can't generate any (voices run on the owner's DeepInfra budget behind the app secret). Options, cheapest first:
  1. *Leave it:* the page links to the originals, and the call to action is how you get to listen. Free.
  2. *Browser speech on the page* (`speechSynthesis`): free and instant, but robotic, needs a script (loosening the no-script CSP), and is unreliable on locked phones.
  3. *Publish rendered audio.* An article costs about 1 cent to render (about $0.99 per million characters), and the daily cap (330,000 characters, about 33 articles) is the whole app's budget, so a 50-item list couldn't be rendered at all. Storage is small by comparison (48 kbps MP3 is about 0.36 MB a minute, so a 10-minute article is 3.6 MB; R2 is $0.015 per GB-month with no egress charge) but it is permanent here, and public audio of other people's writing raises a copyright question text links don't. If done, do it for a single "listen to the first one" sample, only for articles the sharer already rendered (reusing their file, no new voice spend), with an owner-set cap.

## What the spike skips

- Unpublish, edit, or a "my lists" screen beyond a "Shared before" strip with Share again.
- Rate limiting and abuse handling (anyone with the invite can publish; the pages are unmoderated). Counting uploads per secret per day would be the first step.
- A custom domain: links are on the Worker's host (`reader-proxy.<you>.workers.dev/l/<id>`), which is long and not friendly in a chat.
- A square or portrait card variant. There is one 1.91:1 image; an app that crops to a square would cut the sides.
- Per-recipient anything: no view counts, no "N people opened this".
- Accessibility pass on the page beyond semantic HTML and contrast; no translations; non-Latin titles on the card fall back to system fonts.
- Pasted-text articles can be loved but not shared (they have no link).
- Storage hygiene: nothing is ever deleted, and a failed upload after the card is stored can leave an orphan PNG.

## Open questions for the owner

1. **Unpublish.** Should there be one? The smallest version is a per-list delete token returned at publish time, kept in the receipt, and a `DELETE /lists/:id` that checks it. Without it, a mistaken publish is permanent.
2. **Where should links live?** The Worker's host, a custom domain, or the Pages domain through a Pages Function proxying `/l/*`? It changes `PUBLIC_BASE_URL`, and a short branded link helps trust.
3. **Where does "Get Reader" point?** The app is invite-only (invite link carries the secret), so there is no public landing page to send people to. Set `PUBLIC_CTA_URL`, or build a page with a request-an-invite form.
4. **Who may publish?** Today anyone with the invite. Is that right, given the Worker hosts the content and the owner is the one answerable for it?
5. **Is "this week" by love time right?** It uses when you loved it, not when you read it, and it is the calendar week (Monday to Sunday, local time), so on a Monday morning it's empty and "All time" is selected. Alternatives: when finished, or a rolling count of your last N loved articles.
6. **Listening for recipients:** which of the options above, if any? See also the copyright question.
7. **Name on the card.** The field is free text. Should it be required, or prefilled from something?
8. **Does a list need an expiry,** say 90 days, to bound storage and the privacy footprint?
