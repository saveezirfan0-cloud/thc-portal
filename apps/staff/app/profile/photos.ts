import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../db';

/**
 * The selfie, in the private `photos` bucket (§1.6, §10.1).
 *
 * The bucket is private, so a stored path is not a URL and the browser
 * cannot fetch one — a read goes through a signed URL.
 *
 * Unlike `apps/client/app/client/photos.ts`, which has to sign with the
 * service-role key because a customer holds no privilege over a worker's
 * photo at all, nothing here is an escalation. 20260922183015 gives a
 * worker `photos_worker_insert_own` and `photos_worker_read_own` over
 * `<staff_id>/…`, so the caller's OWN session can both write the object
 * and sign a URL for it. Storage RLS is then the gate, not a check written
 * in this app — and the screen works in an environment with no service key,
 * which is every developer's.
 *
 * The path is still built on the server from the session rather than taken
 * from the browser. The policy would refuse a foreign prefix anyway, and so
 * would `staff_set_photo()`; this simply means there is no path parameter
 * for anyone to get wrong.
 */

const BUCKET = 'photos';

/** Long enough to read a page, short enough not to be worth forwarding. */
const READ_TTL_SECONDS = 60 * 10;

export async function signOwnPhoto(path: string | null): Promise<string | null> {
  if (!path || !supabaseConfigured()) return null;
  try {
    const supabase = staffDb(await cookies());
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, READ_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    // Storage being unreachable is not a reason to fail the screen: the
    // photo is an aid to recognition, and `Avatar` falls back to initials.
    return null;
  }
}

/**
 * Where this worker's selfie goes: `<staffId>/selfie-<epoch>.jpg`.
 *
 * The prefix is what `photos_worker_insert_own` and `staff_set_photo()`
 * both check. The epoch keeps a retry after a half-finished upload from
 * colliding with the dead object.
 */
export function photoPathFor(staffId: string): string {
  return `${staffId}/selfie-${Date.now()}.jpg`;
}
