/**
 * Which `check_logs` row is THE check-in of a booking — Scope §1.5, §5.1.
 *
 * `check_logs` holds one row per button press, not one per booking: §1.5's
 * `attempted_at` is "logged regardless of outcome — including attempts that
 * are rejected". A press outside the geofence, a buffer turn-away and the
 * accepted check-in are three rows on the same booking, and only the last
 * of those carries a `check_in_at`. Taking whichever row PostgREST happened
 * to return first rendered a refused attempt as "not checked in" on a
 * worker who was on shift.
 *
 * The rule is the one every SQL reader already uses — `check_out`,
 * `start_break`, `resolve_violation`:
 *
 *   where booking_id = … and check_in_at is not null
 *   order by check_in_at limit 1
 *
 * so the screen and the RPC it calls agree on which log they are talking
 * about. No accepted press yet means no log, never a refused one.
 */
export interface CheckLogLike {
  check_in_at: string | null;
}

export function pickCheckLog<T extends CheckLogLike>(
  logs: readonly T[] | null | undefined,
): T | null {
  let best: T | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const log of logs ?? []) {
    if (log.check_in_at === null || log.check_in_at === undefined) continue;
    const at = Date.parse(log.check_in_at);
    if (Number.isNaN(at)) continue;
    if (at < bestAt) {
      best = log;
      bestAt = at;
    }
  }
  return best;
}
