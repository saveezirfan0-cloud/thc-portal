import { acceptedLog } from '@thc/domain';
import type { NoCheckOutState } from '@thc/domain';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { loadBookings } from '../../data';
import type { BookingRow } from '../../data';
import { venuePoint } from '../venue';
import type { ShiftDetail } from './types';

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * One booking, as the worker who owns it.
 *
 * The role window, the base rate, the event's details and the three
 * static-screen facts come from `staff_bookings()` — the guarded,
 * security-definer reader every Staff App screen uses — never from an
 * embed off `bookings`: a worker holds no select policy on
 * `shift_requirements`, `roles` or `events` (§10.4 Invariant 3, the charge
 * rate must never reach this app), so an embed returns nothing on a real
 * project and the screen rendered a shift with no start, no rate and no
 * venue. The RPC resolves the caller itself, so a forged id finds no row
 * rather than somebody else's shift.
 *
 * The check log, the breaks and the violations are the worker's own rows
 * and carry no money; they are read from their tables under the worker's
 * self policies.
 */
export async function loadShift(
  bookingId: string,
  bookings?: readonly BookingRow[],
): Promise<ShiftDetail | null> {
  if (!supabaseConfigured()) return null;

  const rows = bookings ?? (await loadBookings());
  const booking = rows.find((b) => b.bookingId === bookingId);
  if (!booking) return null;

  const supabase = createClient(await cookies()) as unknown as TableClient;
  const [coords, logs, breaks, violations] = await Promise.all([
    venuePoint(bookingId),
    supabase
      .from('check_logs')
      .select('check_in_at, check_out_at, manager_finish_at, outcome, attempted_at')
      .eq('booking_id', bookingId),
    supabase.from('breaks').select('id, started_at, ended_at').eq('booking_id', bookingId),
    supabase.from('violations').select('type, resolved').eq('booking_id', bookingId),
  ]);

  // `check_logs` is append-only: one row per BUTTON PRESS, not one per
  // booking (§1.5). A strict-buffer turn-away, an out-of-radius refusal and
  // the accepted check-in can all sit under one booking; only the accepted
  // press carries `check_in_at`, and it is the row `check_out()` and
  // `resolve_violation()` update — the same row `payable_shifts_v` prices.
  const logRows = (logs.data ?? []) as CheckLogRow[];
  const log = acceptedLog<CheckLogRow>(logRows);
  const turnedAway = logRows
    .filter((r) => r.outcome === 'turned_away' && r.attempted_at)
    .sort((a, b) => (a.attempted_at! < b.attempted_at! ? 1 : -1))[0];

  const violationRows = (violations.data ?? []) as { type: string; resolved: boolean }[];
  const noCheckoutRow = violationRows.find((v) => v.type === 'no_checkout');
  const noCheckOut: NoCheckOutState = noCheckoutRow
    ? noCheckoutRow.resolved
      ? 'resolved'
      : 'unresolved'
    : booking.noCheckoutOpen
      ? 'unresolved'
      : 'none';

  return {
    bookingId: booking.bookingId,
    status: booking.status,
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    cancelCause: booking.cancelCause,
    eventCancelledAt: booking.eventCancelledAt?.toISOString() ?? null,
    noCheckoutOpen: noCheckOut === 'unresolved',
    leftEarly: violationRows.some((v) => v.type === 'left_early'),
    eventDate: booking.eventDate,
    eventTitle: booking.eventTitle,
    venueName: booking.venueName,
    venueAddress: booking.venueAddress,
    onsiteContact: booking.onsiteContact,
    notes: booking.notes,
    dressCode: booking.dressCode || null,
    roleName: booking.role,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    payRate: booking.payRate,
    venueLat: coords?.lat ?? 0,
    venueLng: coords?.lng ?? 0,
    geofenceRadiusM: coords?.radiusM ?? 0,
    // Null until accepted (the RPC withholds it); a booked shift always has it.
    breaksLogged: booking.paysBreaks === null ? false : !booking.paysBreaks,
    checkInAt: log?.check_in_at ?? null,
    checkOutAt: log?.manager_finish_at ?? log?.check_out_at ?? null,
    noCheckOut,
    turnedAwayAt: turnedAway?.attempted_at ?? null,
    breaks: ((breaks.data ?? []) as BreakRow[])
      .map((b) => ({ id: b.id, startedAt: b.started_at, endedAt: b.ended_at ?? null }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
}

/** The columns of `check_logs` this screen reads. */
export interface CheckLogRow {
  check_in_at: string | null;
  check_out_at: string | null;
  manager_finish_at: string | null;
  outcome?: string | null;
  attempted_at?: string | null;
}

interface BreakRow {
  id: string;
  started_at: string;
  ended_at: string | null;
}

/** See apps/office/app/venues/actions.ts: the generated types are a placeholder. */
interface TableClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}
