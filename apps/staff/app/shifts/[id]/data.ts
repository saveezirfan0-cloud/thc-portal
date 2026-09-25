import type { CancelCause, StaffBookingStatus } from '@thc/domain';
import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../../db';
import type { ShiftDetail } from './types';

export { supabaseConfigured };

/**
 * One booking, as the worker who owns it.
 *
 * Read through `staff_shift_detail()` and nothing else. The staff role holds
 * a SELECT policy on `bookings` only — not on `shift_requirements`, `events`,
 * `roles`, `check_logs` or `breaks`, which carry the charge rate, the client's
 * terms and other workers' records (ADR-0004) — so the PostgREST embed this
 * used to be came back empty for every real worker (docs/15 §2, blocker 1).
 * The function is `security definer`, resolves the caller itself and names
 * only the columns this screen shows; another worker's id returns no row,
 * which the page turns into a 404.
 *
 * The check log it returns is the ACCEPTED press (earliest `check_in_at`,
 * the row `payable_shifts_v` prices and `check_out()` locks), with a
 * manager-entered finish preferred over the pressed one (RULE-02) — decided
 * in SQL, so the screen and payroll read the same row.
 */
export interface ShiftRead {
  /** Null when the booking is not the caller's (or does not exist): a 404. */
  shift: ShiftDetail | null;
  /**
   * The read itself failed. NOT a 404 (audit D18): a worker told their
   * shift does not exist does not turn up, and becomes a No-show. The page
   * shows `<LoadProblem>` with a retry instead.
   */
  problem: string | null;
}

export async function loadShift(bookingId: string): Promise<ShiftRead> {
  if (!supabaseConfigured()) return { shift: null, problem: null };

  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('staff_shift_detail', { p_booking: bookingId });
  if (error) return { shift: null, problem: error.message || 'staff_shift_detail failed' };
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return { shift: null, problem: null };
  return { shift: toShiftDetail(row), problem: null };
}

/** One row of `staff_shift_detail()` in the screen's shape. */
export function toShiftDetail(row: Record<string, unknown>): ShiftDetail {
  const str = (key: string): string | null => (row[key] as string | null | undefined) ?? null;
  const breaks = (row['breaks'] as BreakRow[] | null) ?? [];

  return {
    bookingId: row['booking_id'] as string,
    status: row['status'] as StaffBookingStatus,
    confirmedAt: str('confirmed_at'),
    eventTitle: str('event_title') ?? '',
    eventDate: str('event_date') ?? '',
    venueName: str('venue_name') ?? '',
    venueAddress: str('venue_address') ?? '',
    onsiteContact: str('onsite_contact'),
    notes: str('notes'),
    dressCode: str('dress_code'),
    roleName: str('role') ?? '',
    startsAt: row['starts_at'] as string,
    endsAt: row['ends_at'] as string,
    payRate: Number(row['pay_rate'] ?? 0),
    venueLat: Number(row['venue_lat'] ?? 0),
    venueLng: Number(row['venue_lng'] ?? 0),
    geofenceRadiusM: Number(row['geofence_radius_m'] ?? 0),
    // Null until the booking is accepted (§10.4); a screen that cannot tell
    // shows the Breaks block, which is the one that asks nothing of anyone.
    breaksLogged: row['pays_breaks'] !== true,
    checkInAt: str('check_in_at'),
    checkOutAt: str('check_out_at'),
    breaks: breaks
      .map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt ?? null }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    eventCancelledAt: str('event_cancelled_at'),
    cancelCause: (row['cancel_cause'] as CancelCause | null) ?? null,
    noCheckoutOpen: row['no_checkout_open'] === true,
    // RULE-15: the logged turn-away attempt, which decides whether the
    // worker was on time (paid 4 h) or late (nothing). Null before the
    // column exists (20260929130000) or when they were never turned away.
    turnedAwayAt: str('turned_away_at'),
  };
}

interface BreakRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
}
