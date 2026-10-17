/**
 * When `PushStatus` re-sends this device's subscription to the record
 * (go-live audit H4).
 *
 * It used to call `save_push_subscription` on every screen mount, every
 * focus and every visibility change — 1–3 writes per navigation and per
 * app resume for every worker with notifications on. The upsert only has
 * work to do when something changed, so it is now sent when:
 *
 *   - the subscription is not the one last saved here (a rotated endpoint
 *     or new keys), or
 *   - a different worker is signed in on this phone (a shared device must
 *     re-point its endpoint at whoever is signed in, §10.5), or
 *   - 24 hours have passed (the record may have dropped it: a pruned dead
 *     endpoint, a sign-out elsewhere), or
 *   - we do not know who is signed in, or cannot fingerprint — then always,
 *     as before.
 *
 * What is remembered is a SHA-256 of worker + endpoint + keys, never the
 * endpoint itself: it is a bearer capability to notify this device and is
 * treated like a credential (notifications/actions.ts).
 */
export const SAVED_KEY = 'thc.push.saved';
export const RESAVE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface Fingerprintable {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The hash of who and what was saved, or null when it cannot be made. */
export async function fingerprint(
  subscription: Fingerprintable,
  staffId: string | null | undefined,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string | null> {
  if (!staffId || !subtle) return null;
  try {
    const text = [staffId, subscription.endpoint, subscription.p256dh, subscription.auth].join(
      '\n',
    );
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** What goes in localStorage after a save the record accepted. */
export function savedRecord(print: string, now: number): string {
  return JSON.stringify({ p: print, at: now });
}

/** Whether to send the subscription again, given what this device remembers. */
export function shouldSave(record: string | null, print: string | null, now: number): boolean {
  if (!print || !record) return true;
  try {
    const parsed = JSON.parse(record) as { p?: unknown; at?: unknown };
    if (parsed.p !== print || typeof parsed.at !== 'number') return true;
    return now - parsed.at >= RESAVE_AFTER_MS || now < parsed.at;
  } catch {
    return true;
  }
}
