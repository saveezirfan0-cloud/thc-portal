import { cache } from 'react';
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

/**
 * An hour, reused for the first half of it (go-live audit M1).
 *
 * The shell signs the header avatar on every screen, and every refresh. A
 * fresh token each time gave the selfie a new URL on every request, so the
 * browser could never reuse the image it already had: one Storage call and
 * one image download per navigation, on venue data. A link is now handed
 * out again until half its life has gone, so the browser's cache hits and
 * whatever a page shows still has at least half an hour to run. The bucket
 * stays private; nothing about who may sign changes.
 */
const READ_TTL_SECONDS = 60 * 60;

/** How many signed links one server instance keeps; least recently used goes first. */
const CACHE_ENTRIES = 2000;

/**
 * A bounded, least-recently-used store of signed links keyed by Storage
 * path, each reused until `reuseMs` after it was signed — the Client
 * Portal's `signedUrlCache` (apps/client/app/client/photos.ts), kept as its
 * own copy here rather than imported across apps.
 *
 * Per server instance and shared by every request it serves — which adds no
 * reach: the only paths ever looked up are the caller's own, read on the
 * server from their session (`staff_me()` / `onboarding_state()`), never
 * taken from the browser; and the path carries the upload's epoch
 * (`photoPathFor`), so a new selfie is a new key, never a stale hit.
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
  };
}

/** Reused until half its life has gone. */
export const ownPhotoUrls = signedUrlCache({
  max: CACHE_ENTRIES,
  reuseMs: (READ_TTL_SECONDS * 1000) / 2,
});

/**
 * Signed once per request (`React.cache`): the shell signs it for the
 * header on every screen (§10.1), and /profile signs the same path again
 * for the sheet, so without this a profile visit would cost two Storage
 * round trips for one image. Across requests, `ownPhotoUrls` hands the
 * same link back for half an hour.
 */
export const signOwnPhoto = cache(async (path: string | null): Promise<string | null> => {
  if (!path || !supabaseConfigured()) return null;
  const reused = ownPhotoUrls.get(path);
  if (reused) return reused;
  try {
    const supabase = staffDb(await cookies());
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, READ_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    ownPhotoUrls.set(path, data.signedUrl);
    return data.signedUrl;
  } catch {
    // Storage being unreachable is not a reason to fail the screen: the
    // photo is an aid to recognition, and `Avatar` falls back to initials.
    return null;
  }
});

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
