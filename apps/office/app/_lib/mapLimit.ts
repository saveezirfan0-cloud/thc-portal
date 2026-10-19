/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight.
 *
 * The database is a small shared-CPU instance, and PostgREST holds one
 * connection per request for as long as the statement runs. A page that
 * fires one heavy RPC per item all at once (the event board asked for every
 * section's candidate pool and calendar together: 2 × sections calls) takes
 * every connection in the pool, and every other request — the sidebar, the
 * Staff App, the jobs — queues behind it until the 8 s statement limit
 * cancels them. Results come back in the order of `items`, as
 * `Promise.all` gives them.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => PromiseLike<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}
