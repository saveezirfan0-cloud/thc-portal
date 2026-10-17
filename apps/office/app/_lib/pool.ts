/**
 * Run `work` over `items` with at most `limit` calls in flight, results in
 * the items' order (go-live audit 17.10.2026, M5).
 *
 * The bulk actions — "Link ticked" on /staff/roster (up to 1,000 rows), "+ Add
 * staff" on a client card (workers × roles) — made one RPC per item strictly
 * one after another: 30–80 s for a full batch, long enough for the function
 * to time out halfway. Each item is still its own call, refused or done on
 * its own, so per-item reporting is unchanged; only the waiting is shared.
 *
 * `stop(result)` returning true starts nothing new (the calls already in
 * flight finish and keep their results); items never started come back as
 * `undefined`. Pure: pinned by `__tests__/pool.test.ts`.
 */
export const BULK_CONCURRENCY = 8;

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  stop: (result: R) => boolean = () => false,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < items.length) {
      const index = next++;
      const result = await work(items[index]!, index);
      results[index] = result;
      if (stop(result)) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}
