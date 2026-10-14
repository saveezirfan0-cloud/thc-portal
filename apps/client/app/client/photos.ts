import { createAdminClient } from '@thc/db/admin';
import type { ClientLineupRow, LineupRecord } from './data';

/**
 * Signed URLs for the line-up photos (§11.1).
 *
 * "photos of the confirmed workers (not initials — so the customer
 * recognises the people by face)". The selfie from onboarding (§10.3 step
 * 3) lives in the private `photos` bucket, so a path is not a URL and the
 * browser cannot fetch one directly.
 *
 * Why the service-role key, when everything else in this app deliberately
 * goes through the caller's own session:
 *
 *   The `photos` bucket IS covered by row-level security on
 *   `storage.objects` (`20260922183015_storage_buckets_and_policies.sql`):
 *   a worker may write and read their own selfie (`photos_worker_*_own`)
 *   and an admin may read every one (`photos_admin_read`). There is no
 *   client policy, and by ADR-0004 there must not be one — the client role
 *   gets a policy only on a table carrying no worker personal data, and a
 *   selfie is exactly that. So the customer's own session cannot sign or
 *   fetch a photo, and the only alternative to signing server-side would
 *   be opening the bucket, which would put every worker's selfie behind a
 *   guessable path for anyone, not just this customer.
 *
 * The narrowness is what makes it safe, and it is worth stating exactly:
 * this function signs ONLY paths that `client_lineup_v` has already
 * returned for this caller, and that view applies `client_portal_visible()`
 * to every row. So the set of paths is authorised before it reaches here;
 * this adds no reach, it only turns authorised paths into fetchable URLs.
 * Callers must never pass a path from anywhere else.
 *
 * createAdminClient() itself throws if it is ever reached from the browser,
 * so this module cannot be bundled into a client component by accident.
 *
 * When the service key is absent — which is every environment until docs/04
 * step 2 is done — this returns an empty map and `Avatar` falls back to
 * monogram initials rather than breaking the screen.
 *
 * What a client component receives is the signed URL keyed by `bookingId`,
 * never `photoPath` as a field of its own: `presentLineup` is the one door
 * from the server's `LineupRecord` to the props of a client component. That
 * is tidiness, not secrecy — a Supabase signed URL carries the object's path
 * in clear (`…/object/sign/photos/<staff_id>/<file>?token=…`), so the
 * worker's `staff.id` does reach the browser inside each photo's URL.
 * ADR-0026 §4 accepts that: the id is an opaque uuid that opens nothing
 * without the token, and the token is per object and short-lived.
 *
 * Links are reused (`signedUrlCache`): the pages re-render every minute
 * (AutoRefresh), and a fresh token each time gave every face a new URL, so
 * the browser re-downloaded every photo every minute — on mobile data — and
 * the faces flickered. A link is now handed out again until half its life
 * has gone, so whatever a page shows still has at least that half to run.
 */

/** Long enough to read a page, short enough not to be worth forwarding. */
const TTL_SECONDS = 60 * 10;

const BUCKET = 'photos';

/** How many signed links the server keeps; least recently used goes first. */
const CACHE_ENTRIES = 5000;

/**
 * A bounded, least-recently-used store of signed links keyed by Storage
 * path, each reused until `reuseMs` after it was signed.
 *
 * Per server instance and shared by every customer it serves — which adds no
 * reach: a path is only ever looked up after `client_lineup_v` returned it
 * for THIS caller (see above), and the answer is the link anyone holding that
 * path from the view would have been given.
 */
export function signedUrlCache(options: { max: number; reuseMs: number; now?: () => number }) {
  const now = options.now ?? (() => Date.now());
  // A Map iterates in insertion order: re-inserting on use makes the first
  // key the least recently used.
  const entries = new Map<string, { url: string; signedAt: number }>();

  return {
    get(path: string): string | undefined {
      const hit = entries.get(path);
      if (!hit) return undefined;
      entries.delete(path);
      if (now() - hit.signedAt >= options.reuseMs) return undefined;
      entries.set(path, hit);
      return hit.url;
    },
    set(path: string, url: string, signedAt: number = now()): void {
      entries.delete(path);
      entries.set(path, { url, signedAt });
      while (entries.size > options.max) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}

/** Reused until half its life has gone (TTL_SECONDS). */
export const photoUrls = signedUrlCache({ max: CACHE_ENTRIES, reuseMs: (TTL_SECONDS * 1000) / 2 });

/** Signed photo URLs keyed by `bookingId`; a booking with no photo is absent. */
export async function signLineupPhotos(
  rows: readonly Pick<LineupRecord, 'bookingId' | 'photoPath'>[],
): Promise<Map<string, string>> {
  const byPath = await signPaths(rows.map((r) => r.photoPath));
  const signed = new Map<string, string>();
  for (const r of rows) {
    const url = r.photoPath ? byPath.get(r.photoPath) : undefined;
    if (url) signed.set(r.bookingId, url);
  }
  return signed;
}

/**
 * The line-up as a client component may receive it: every field the screens
 * render, named one by one so a column added to `LineupRecord` later does not
 * ride along by default, and the photos keyed by booking.
 */
export function publicLineup(rows: readonly LineupRecord[]): ClientLineupRow[] {
  return rows.map((r) => ({
    bookingId: r.bookingId,
    eventId: r.eventId,
    shiftId: r.shiftId,
    role: r.role,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    name: r.name,
    sortKey: r.sortKey,
    feedbackGiven: r.feedbackGiven,
    // The customer's OWN entry: its stars and when it was sent (§11.2).
    feedbackRating: r.feedbackRating,
    feedbackSentAt: r.feedbackSentAt,
    // On the day, on the event page only (ADR-0135 §1).
    ...(r.arrivalStatus !== undefined
      ? { arrivalStatus: r.arrivalStatus, arrivedAt: r.arrivedAt ?? null }
      : {}),
    // ADR-0135 §2: "✓ Requested", on the event page only.
    ...(r.workerRequested !== undefined ? { workerRequested: r.workerRequested } : {}),
  }));
}

/**
 * The line-up for a client component, and photos for `shown` only — the
 * faces the screen actually draws (the list shows a handful per event,
 * `listFaces` in rules.ts; the event page shows everyone). `shown` must be
 * drawn from `rows`. Defaults to every row.
 */
export async function presentLineup(
  rows: readonly LineupRecord[],
  shown: readonly LineupRecord[] = rows,
): Promise<{ lineup: ClientLineupRow[]; photos: Record<string, string> }> {
  const signed = await signLineupPhotos(shown);
  return { lineup: publicLineup(rows), photos: Object.fromEntries(signed) };
}

async function signPaths(paths: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = new Map<string, string>();

  if (wanted.length === 0 || !process.env.SUPABASE_SERVICE_ROLE_KEY) return signed;

  // A link still in its first half-life is handed out again, unchanged.
  const fresh: string[] = [];
  for (const path of wanted) {
    const url = photoUrls.get(path);
    if (url) signed.set(path, url);
    else fresh.push(path);
  }
  if (fresh.length === 0) return signed;

  try {
    const admin = createAdminClient();
    const signedAt = Date.now();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(fresh, TTL_SECONDS);
    if (error || !data) return signed;

    for (const entry of data) {
      // createSignedUrls reports per-path failures in the row rather than
      // throwing, so a worker whose file is missing loses their photo and
      // nobody else's page breaks. A failure is not cached: the next render
      // asks again.
      if (entry.signedUrl && entry.path) {
        signed.set(entry.path, entry.signedUrl);
        photoUrls.set(entry.path, entry.signedUrl, signedAt);
      }
    }
  } catch {
    // Storage being unreachable is not a reason to fail the line-up: §11.2's
    // photo is an aid to recognition, not the record.
    return signed;
  }

  return signed;
}
