/**
 * gdpr-purge — the Storage half of §1.7 removal.
 *
 * `remove_worker()` anonymises the row and deletes the records, but the
 * OBJECTS those records pointed at — a passport scan in `documents`, a
 * selfie in `photos` — live in Storage, which SQL cannot reach. §1.7 says
 * "contacts / documents / photo wiped", so something has to make that
 * call. This is it.
 *
 * It needs no key the platform does not already hold: the service role
 * key every §7 job carries is also what the Storage API wants.
 *
 * Queue-driven rather than called inline by the removal, for the reason
 * the outbox is: an erasure obligation must not be lost because Storage
 * was briefly unreachable. A row stays in `storage_deletions` until the
 * object is actually gone, so a failed purge is visible and retried
 * rather than silently dropped.
 *
 * Idempotent by construction. Supabase's `remove` does not error on a
 * path that is already gone, so a row claimed twice — or an object a
 * previous run deleted before crashing — completes cleanly the second
 * time.
 */

import { runJob } from '../_shared/job.ts';

interface Pending {
  id: number;
  bucket: string;
  path: string;
}

export const BATCH = 100;

Deno.serve((request) =>
  runJob('gdpr-purge', request, async (db) => {
    const { data, error } = await db.rpc('claim_storage_deletions', { p_limit: BATCH });
    if (error) throw new Error(`claim_storage_deletions: ${error.message}`);

    const pending = (data ?? []) as Pending[];
    let deleted = 0;
    let failed = 0;

    // One call per bucket, not per object: the Storage API takes a list,
    // and a worker's documents are nearly always in the same bucket.
    const byBucket = new Map<string, Pending[]>();
    for (const row of pending) {
      const rows = byBucket.get(row.bucket) ?? [];
      rows.push(row);
      byBucket.set(row.bucket, rows);
    }

    for (const [bucket, rows] of byBucket) {
      const { error: removeError } = await db.storage.from(bucket).remove(rows.map((r) => r.path));
      for (const row of rows) {
        const { error: completeError } = await db.rpc('complete_storage_deletion', {
          p_id: row.id,
          p_ok: !removeError,
          p_error: removeError ? `${bucket}: ${removeError.message}` : null,
        });
        // A completion that does not land would re-delete an object that
        // is already gone — harmless — but the count has to be honest.
        if (completeError) throw new Error(`complete_storage_deletion: ${completeError.message}`);
        if (removeError) failed += 1;
        else deleted += 1;
      }
    }

    return { claimed: pending.length, deleted, failed };
  }),
);
