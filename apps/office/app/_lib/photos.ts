import { cookies } from 'next/headers';
import { createAdminClient } from '@thc/db/admin';
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
 * Why the service-role key, and why that is narrow enough:
 *
 *   - Signing is batched (`createSignedUrls`), one round trip per page,
 *     whatever the number of rows.
 *   - The caller must be a signed-in admin, established through the
 *     SESSION client against `profiles` — the same gate as the privileged
 *     actions in staff/[id]/actions.ts. Anyone else gets an empty map.
 *   - The paths come only from views the caller has already read through
 *     their own session (RLS decided those rows), never from the browser.
 *     Callers must keep it that way.
 *
 * Every failure — no project, no service key, not an admin, storage down, a
 * missing object — degrades to "no URL" for that path, and `Avatar` draws
 * the initials instead. A photo is an aid to recognition, never the record,
 * so it is not a reason to fail a screen.
 *
 * `createAdminClient()` throws in a browser, so this module cannot end up in
 * a client bundle unnoticed.
 */

const BUCKET = 'photos';

/** Long enough to read a page, short enough not to be worth forwarding. */
export const PHOTO_URL_TTL_SECONDS = 60 * 10;

function configured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] &&
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] &&
    process.env['SUPABASE_SERVICE_ROLE_KEY'],
  );
}

/** The signed-in caller is an office admin. Read through the session, never a claim. */
export async function callerIsAdmin(): Promise<boolean> {
  try {
    const supabase = createClient(await cookies());
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return false;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .maybeSingle<{ role: string }>();
    return profile?.role === 'admin';
  } catch {
    return false;
  }
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
  if (!(await callerIsAdmin())) return signed;

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUrls(wanted, PHOTO_URL_TTL_SECONDS);
    if (error || !data) return signed;
    for (const entry of data) {
      // Per-path failures come back in the row, not as a throw: one missing
      // object costs that worker their photo and nobody else theirs.
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
