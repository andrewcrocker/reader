import { db, getSettings, updateSettings } from '../db';

/** The Worker answered 401: the saved secret is wrong or was changed. Shows the invite screen. */
export function noteInviteRejected(): void {
  void updateSettings({ inviteRejected: true });
}

/** A new invite arrived: save it, and retry anything that failed for lack of one. */
export async function acceptInvite(secret: string): Promise<void> {
  await updateSettings({ proxySecret: secret, inviteRejected: false });
  await db.articles
    .where('status')
    .equals('failed')
    .modify((a) => {
      if (a.errorKind !== 'service') return;
      a.status = a.chunks?.length ? 'extracted' : 'fetching';
      a.error = undefined;
      a.errorKind = undefined;
    });
}

/** Asks the Worker whether the saved invite still works; a 401 shows the invite screen. Offline or unreachable: no verdict. */
export async function checkInvite(): Promise<void> {
  const s = await getSettings();
  if (!s.proxySecret || !navigator.onLine) return;
  try {
    const res = await fetch(`${s.proxyUrl.replace(/\/$/, '')}/ping`, { headers: { 'X-App-Secret': s.proxySecret }, cache: 'no-store' });
    if (res.status === 401) noteInviteRejected();
    else if (res.ok && s.inviteRejected) await updateSettings({ inviteRejected: false });
  } catch {
    /* can't tell; the next real request will */
  }
}
