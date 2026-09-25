/**
 * Signed URLs for the selfies on the monitor (§9.5 "Photo + name (the real
 * selfie taken during onboarding)").
 *
 * `staff.photo_path` is an object path inside the private `photos` bucket
 * (`<staff_id>/selfie-<epoch>.jpg`, written by `upload_profile_photo`), so
 * it is not a URL: handed to `<img src>` it resolves against the office
 * origin and the manager sees alt text instead of a face. Every path is
 * turned into a short-lived signed URL here before it reaches a component,
 * and the row types carry `photoUrl`, never the path, so a component
 * cannot take the shortcut by accident.
 *
 * The manager's OWN session does the signing. The Back Office reads the
 * bucket through `photos_admin_read` (20260922183015_storage_buckets_and_
 * policies.sql), which admits `current_app_role() = 'admin'`, so no
 * service-role key is involved — unlike the Client Portal's line-up, which
 * has no Storage policy of its own and signs with the admin client. That
 * keeps the monitor working in every environment a manager can sign in to,
 * and it means Storage — not this file — decides what an admin may see.
 *
 * A signing failure loses that worker's photo and nobody else's: the
 * monitor is the screen a manager acts on while the shift is running, and
 * a missing selfie is not a reason to lose the board. `Avatar` falls back
 * to initials on `undefined`.
 */

/** The monitor refreshes every 30 s and re-signs; ten minutes is ample. */
const TTL_SECONDS = 60 * 10;

const BUCKET = 'photos';

/**
 * The slice of a Supabase client this needs, spelled out so the loader can
 * be tested with a stub and so the helper never reaches for a table.
 */
export interface PhotoSigner {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): PromiseLike<{
        data: { path: string | null; signedUrl: string | null }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export async function signPhotos(
  supabase: PhotoSigner,
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const signed = new Map<string, string>();
  if (wanted.length === 0) return signed;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(wanted, TTL_SECONDS);
    if (error || !data) return signed;
    for (const entry of data) {
      // Per-path failures come back in the row rather than throwing.
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
    }
  } catch {
    return signed;
  }
  return signed;
}
