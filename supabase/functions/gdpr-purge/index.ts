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
 * Two kinds of row (20260927160400):
 *   · a named object — removed by path, as before;
 *   · a PREFIX (`<staff_id>/`) — the worker's whole folder in that bucket,
 *     listed recursively and removed, EXCEPT the paths
 *     `retained_storage_paths()` still names (a completion letter held
 *     under ADR-0019's retention). This is what erases an object that
 *     reached the bucket without a row: an upload whose finish…() never
 *     ran, a selfie whose staff_set_photo() raised. A prefix with nothing
 *     under it completes cleanly.
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
  prefix: boolean;
  staff_id: string | null;
}

/** The subset of the Storage client this job uses, so listing is testable. */
export interface BucketLike {
  list(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    data: { name: string; id: string | null }[] | null;
    error: { message: string } | null;
  }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

export const BATCH = 100;
const PAGE = 1000;

/**
 * Every object under `prefix`, recursively. Storage's list() is one level
 * deep and reports a folder as an entry with a null id; those are walked.
 */
export async function listUnder(bucket: BucketLike, prefix: string): Promise<string[]> {
  const folder = prefix.replace(/\/$/, '');
  const found: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await bucket.list(folder, { limit: PAGE, offset });
    if (error) throw new Error(`list ${folder}: ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) found.push(...(await listUnder(bucket, path)));
      else found.push(path);
    }
    if (entries.length < PAGE) break;
    offset += PAGE;
  }
  return found;
}

Deno.serve((request) =>
  runJob('gdpr-purge', request, async (db) => {
    const { data, error } = await db.rpc('claim_storage_deletions', { p_limit: BATCH });
    if (error) throw new Error(`claim_storage_deletions: ${error.message}`);

    const pending = (data ?? []) as Pending[];
    let deleted = 0;
    let failed = 0;
    let swept = 0;

    const complete = async (row: Pending, removeError: { message: string } | null) => {
      const { error: completeError } = await db.rpc('complete_storage_deletion', {
        p_id: row.id,
        p_ok: !removeError,
        p_error: removeError ? `${row.bucket}: ${removeError.message}` : null,
      });
      // A completion that does not land would re-delete an object that
      // is already gone — harmless — but the count has to be honest.
      if (completeError) throw new Error(`complete_storage_deletion: ${completeError.message}`);
      if (removeError) failed += 1;
      else deleted += 1;
    };

    // One call per bucket, not per object: the Storage API takes a list,
    // and a worker's documents are nearly always in the same bucket.
    const byBucket = new Map<string, Pending[]>();
    for (const row of pending) {
      if (row.prefix) continue;
      const rows = byBucket.get(row.bucket) ?? [];
      rows.push(row);
      byBucket.set(row.bucket, rows);
    }

    for (const [bucket, rows] of byBucket) {
      const { error: removeError } = await db.storage.from(bucket).remove(rows.map((r) => r.path));
      for (const row of rows) await complete(row, removeError);
    }

    // The prefixes: list, keep what the law keeps, remove the rest.
    for (const row of pending) {
      if (!row.prefix) continue;
      try {
        const bucket = db.storage.from(row.bucket) as unknown as BucketLike;
        let paths = await listUnder(bucket, row.path);
        if (row.staff_id && paths.length > 0) {
          const { data: kept, error: keptError } = await db.rpc('retained_storage_paths', {
            p_staff: row.staff_id,
          });
          if (keptError) throw new Error(`retained_storage_paths: ${keptError.message}`);
          const retained = new Set(((kept ?? []) as string[]).map(String));
          paths = paths.filter((p) => !retained.has(p));
        }
        if (paths.length > 0) {
          const { error: removeError } = await bucket.remove(paths);
          if (removeError) throw new Error(removeError.message);
          swept += paths.length;
        }
        await complete(row, null);
      } catch (cause) {
        await complete(row, { message: cause instanceof Error ? cause.message : String(cause) });
      }
    }

    return { claimed: pending.length, deleted, failed, swept };
  }),
);
