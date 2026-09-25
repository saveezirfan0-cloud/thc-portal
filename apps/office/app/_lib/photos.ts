import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

/**
 * Signed URLs for worker selfies in the Back Office (§1.6: "the onboarding
 * selfie carries through the whole system").
 *
 * The selfie lives in the private `photos` bucket, so the `photo_path` a
 * view returns is a storage key, not a URL. Handing it to `<img src>` — as
 * the check-in monitor used to — asks the browser for a relative path on
 * this site and draws a broken image; the directory, the profile header and
 * the client card's qualified staff passed no `src` at all. Every office
 * screen that shows a face now goes through this one function.
 *
 * The signed-in manager's OWN session does the signing — no service-role
 * key. Storage admits the read through `photos_admin_read`
 * (20260922183015_storage_buckets_and_policies.sql: `bucket_id = 'photos'
 * and current_app_role() = 'admin'`, pinned by supabase/tests/320_storage.sql),
 * so Storage, not this file, decides what may be signed. A caller who is not
 * an admin gets a per-path refusal (a worker, at most their own folder),
 * which lands here as "no URL". Signing is batched (`createSignedUrls`):
 * one round trip per page, whatever the number of rows.
 *
 * The paths still come only from views the caller has already read through
 * their own session (RLS decided those rows), never from the browser.
 *
 * Every failure — no project, no session, not an admin, storage down, a
 * missing object — degrades to "no URL" for that path, and `Avatar` draws
 * the initials instead. A photo is an aid to recognition, never the record,
 * so it is not a reason to fail a screen.
 *
 * `@thc/db/server` imports `server-only`, so this module cannot end up in a
 * client bundle unnoticed.
 */

const BUCKET = 'photos';

/** Long enough to read a page, short enough not to be worth forwarding. */
export const PHOTO_URL_TTL_SECONDS = 60 * 10;

function configured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

/**
 * Path → short-lived URL for every distinct, non-empty path. Paths that
 * could not be signed are simply absent from the map.
 */
export async function signStaffPhotos(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (wanted.length === 0 || !configured()) return signed;

  try {
    const { data, error } = await createClient(await cookies())
      .storage.from(BUCKET)
      .createSignedUrls(wanted, PHOTO_URL_TTL_SECONDS);
    if (error || !data) return signed;
    for (const entry of data) {
      // Per-path failures come back in the row, not as a throw: one missing
      // object (or one Storage refusal) costs that worker their photo and
      // nobody else theirs.
      if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl);
    }
  } catch {
    return signed;
  }
  return signed;
}

/**
 * The rows with `photo_url` set from their `photo_path` (null when absent or
 * unsignable). A removed worker's view row already carries no path (§1.7).
 */
export async function withPhotoUrls<T extends { photo_path: string | null }>(
  rows: readonly T[],
): Promise<(T & { photo_url: string | null })[]> {
  const urls = await signStaffPhotos(rows.map((row) => row.photo_path));
  return rows.map((row) => ({
    ...row,
    photo_url: row.photo_path ? (urls.get(row.photo_path) ?? null) : null,
  }));
}
