import { createAdminClient } from '@thc/db/admin';

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
 */

/** Long enough to read a page, short enough not to be worth forwarding. */
const TTL_SECONDS = 60 * 10;

const BUCKET = 'photos';

export async function signLineupPhotos(
  paths: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = new Map<string, string>();

  if (wanted.length === 0 || !process.env.SUPABASE_SERVICE_ROLE_KEY) return signed;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(wanted, TTL_SECONDS);
    if (error || !data) return signed;

    for (const entry of data) {
      // createSignedUrls reports per-path failures in the row rather than
      // throwing, so a worker whose file is missing loses their photo and
      // nobody else's page breaks.
      if (entry.signedUrl && entry.path) signed.set(entry.path, entry.signedUrl);
    }
  } catch {
    // Storage being unreachable is not a reason to fail the line-up: §11.2's
    // photo is an aid to recognition, not the record.
    return signed;
  }

  return signed;
}
