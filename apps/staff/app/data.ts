import { cookies } from 'next/headers';
import type { CancelCause, OpenShiftRow, StaffBooking, StaffBookingStatus } from '@thc/domain';
import { staffDb, supabaseConfigured } from './db';

/**
 * Everything the three working screens read — Scope §10.4.
 *
 * Two RPCs and nothing else. `staff_bookings()` and `staff_open_shifts()` are
 * `security definer` and resolve the caller themselves, so this layer never
 * names a worker: there is no id here for a forged request to swap.
 */

export interface BookingRow extends StaffBooking {
  bookingId: string;
  source: string;
  createdAt: Date;
  confirmedAt: Date | null;
  appliedAt: Date | null;
  reconfirmReason: string | null;
  shiftId: string;
  payRate: number;
  dressCode: string;
  headcount: number;
  buffer: number;
  confirmedCount: number;
  role: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  venueAddress: string;
  distanceKm: number | null;
  /** Null until the booking is accepted — the view withholds it (§10.4). */
  onsiteContact: string | null;
  notes: string | null;
  paysBreaks: boolean | null;
  /** RULE-20, read live for the week this SECTION falls in (§10.4, §4.4). */
  hoursLimit: boolean;
  weekStart: string | null;
  bookedHours: number | null;
  capHours: number | null;
}

export interface OpenShift extends OpenShiftRow {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  role: string;
  endsAt: Date;
  payRate: number;
  dressCode: string;
  venueName: string;
  venueAddress: string;
  headcount: number;
  buffer: number;
  confirmedCount: number;
  weekStart: string | null;
  bookedHours: number | null;
  capHours: number | null;
}

const date = (value: unknown): Date | null => (value ? new Date(value as string) : null);

export async function loadBookings(): Promise<BookingRow[]> {
  if (!supabaseConfigured()) return [];
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('staff_bookings');
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    bookingId: row['booking_id'] as string,
    status: row['status'] as StaffBookingStatus,
    source: row['source'] as string,
    createdAt: new Date(row['created_at'] as string),
    confirmedAt: date(row['confirmed_at']),
    dayBeforeConfirmedAt: date(row['day_before_confirmed_at']),
    onDayConfirmedAt: date(row['on_day_confirmed_at']),
    reconfirmRequired: Boolean(row['reconfirm_required']),
    reconfirmReason: (row['reconfirm_reason'] as string) ?? null,
    appliedAt: date(row['applied_at']),
    // bookings_cancel_cause_check holds the column to CANCEL_CAUSES.
    cancelCause: (row['cancel_cause'] as CancelCause | null) ?? null,
    shiftId: row['shift_id'] as string,
    startsAt: new Date(row['starts_at'] as string),
    endsAt: new Date(row['ends_at'] as string),
    payRate: Number(row['pay_rate']),
    dressCode: (row['dress_code'] as string) ?? '',
    headcount: Number(row['headcount']),
    buffer: Number(row['buffer']),
    confirmedCount: Number(row['confirmed_count']),
    role: row['role'] as string,
    eventId: row['event_id'] as string,
    eventTitle: row['event_title'] as string,
    eventDate: row['event_date'] as string,
    venueName: row['venue_name'] as string,
    venueAddress: row['venue_address'] as string,
    eventCancelledAt: date(row['event_cancelled_at']),
    distanceKm: row['distance_km'] === null ? null : Number(row['distance_km']),
    onsiteContact: (row['onsite_contact'] as string) ?? null,
    notes: (row['notes'] as string) ?? null,
    paysBreaks: row['pays_breaks'] === null ? null : Boolean(row['pays_breaks']),
    noCheckoutOpen: Boolean(row['no_checkout_open']),
    hoursLimit: Boolean(row['hours_limit']),
    weekStart: (row['week_start'] as string) ?? null,
    bookedHours: row['booked_hours'] === null ? null : Number(row['booked_hours']),
    capHours: row['cap_hours'] === null ? null : Number(row['cap_hours']),
  }));
}

export async function loadOpenShifts(): Promise<OpenShift[]> {
  if (!supabaseConfigured()) return [];
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('staff_open_shifts');
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    shiftId: row['shift_id'] as string,
    eventId: row['event_id'] as string,
    eventTitle: row['event_title'] as string,
    eventDate: row['event_date'] as string,
    role: row['role'] as string,
    startsAt: new Date(row['starts_at'] as string),
    endsAt: new Date(row['ends_at'] as string),
    payRate: Number(row['pay_rate']),
    dressCode: (row['dress_code'] as string) ?? '',
    venueName: row['venue_name'] as string,
    venueAddress: row['venue_address'] as string,
    distanceKm: row['distance_km'] === null ? null : Number(row['distance_km']),
    headcount: Number(row['headcount']),
    buffer: Number(row['buffer']),
    confirmedCount: Number(row['confirmed_count']),
    qualified: Boolean(row['qualified']),
    hoursLimit: Boolean(row['hours_limit']),
    appliedAt: date(row['applied_at']),
    weekStart: (row['week_start'] as string) ?? null,
    bookedHours: row['booked_hours'] === null ? null : Number(row['booked_hours']),
    capHours: row['cap_hours'] === null ? null : Number(row['cap_hours']),
  }));
}

export async function findBooking(bookingId: string): Promise<BookingRow | null> {
  const all = await loadBookings();
  return all.find((b) => b.bookingId === bookingId) ?? null;
}

export async function findOpenShift(shiftId: string): Promise<OpenShift | null> {
  const all = await loadOpenShifts();
  return all.find((s) => s.shiftId === shiftId) ?? null;
}

/**
 * The invitations a worker may still answer — Scope §10.4.
 *
 * RULE-16 lives here rather than in the query, because `staff_bookings()`
 * has to keep returning everything: a worker tapping a stale push needs the
 * detail route to find the row and show them the static message, not a 404.
 * What this filters is the LIST.
 *
 * An invitation goes when its section has ended ("an open invitation
 * disappears on its own once the event it belongs to has ended — even if the
 * worker never accepted or declined it"), and when the office cancels the
 * event ("the shift's card simply disappears from the list the moment the
 * push arrives"). Neither waits for a job: an Accept on either would be
 * refused by `accept_invite`, so offering the button is the bug.
 */
export function openInvites(bookings: readonly BookingRow[], now: Date = new Date()): BookingRow[] {
  return bookings.filter(
    (b) => b.status === 'invited' && !b.eventCancelledAt && b.endsAt.getTime() > now.getTime(),
  );
}
