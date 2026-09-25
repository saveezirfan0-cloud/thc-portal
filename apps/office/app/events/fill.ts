/**
 * Which bookings fill a slot — Scope §3.1, §3.2.
 *
 * Check-in moves a booking from `confirmed` to `worked` (state.ts,
 * `check_in()`), and the worker still holds the slot — so an Ongoing event
 * with everyone on site is "10 of 10", not "0 of 10 · 10 open". Every SQL
 * fill (`event_fill_v`, the `client_*` views, `dashboard_kpis`) counts the
 * same pair; the list once read `confirmed` alone. Pure, so the loaders
 * and the tests share it without the server-only database client.
 */

export const FILL_BOOKING_STATUSES = ['confirmed', 'worked'] as const;

export function countsTowardsFill(status: string): boolean {
  return (FILL_BOOKING_STATUSES as readonly string[]).includes(status);
}

/** Confirmed-or-worked bookings per section id — the number the fill uses. */
export function tallyFill(rows: { shift_id: string; status: string }[]): Map<string, number> {
  const fill = new Map<string, number>();
  for (const row of rows) {
    if (!countsTowardsFill(row.status)) continue;
    fill.set(row.shift_id, (fill.get(row.shift_id) ?? 0) + 1);
  }
  return fill;
}
