// Handing a reading-list link to someone (SPEC §4 "Sharing a reading list"): the system share sheet where
// there is one, the clipboard where there isn't. Used by "Share as list" and by sharing from Saved.

export type SendOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Closing the share sheet isn't an error. */
const cancelled = (e: unknown) => (e as Error | undefined)?.name === 'AbortError';

export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Share `url`, with `image` attached when the device can share files. Only the link goes with it, no extra
 * text: Android's Copy (and many apps) prepend any text, which makes pasting it messier. The list's name and
 * articles travel inside the link and show when it's opened.
 *
 * If the image can't be shared (the device can't, or it fails for a reason other than the person closing the
 * sheet), the plain link goes to the share sheet, and failing that to the clipboard. 'cancelled' means they
 * closed the sheet: the caller should stay where it is so they can try again.
 */
export async function sendLink(url: string, image?: File): Promise<SendOutcome> {
  if (typeof navigator.share === 'function') {
    if (image && navigator.canShare?.({ files: [image] })) {
      try {
        await navigator.share({ files: [image], url });
        return 'shared';
      } catch (e) {
        if (cancelled(e)) return 'cancelled';
      }
    }
    try {
      await navigator.share({ url });
      return 'shared';
    } catch (e) {
      if (cancelled(e)) return 'cancelled';
    }
  }
  return (await copyLink(url)) ? 'copied' : 'failed';
}
