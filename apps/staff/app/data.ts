import { cookies } from 'next/headers';
import { UK_ZONE, formatTimeIn, overlapVerdict } from '@thc/domain';
import type { CancelCause, OpenShiftRow, StaffBooking, StaffBookingStatus } from '@thc/domain';
import { staffDb, supabaseConfigured } from './db';
import { isCurrent, isMine } from './shifts/model';

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
  /**
   * The venue's pin and geofence, and the worker's home pin, for the
   * detail's map (wireframes/staff/radar.html, ADR-0005). Null where the
   * worker has no home pin yet — the map then shows the venue alone.
   */
  venueLat: number | null;
  venueLng: number | null;
  geofenceRadiusM: number | null;
  homeLat: number | null;
  homeLng: number | null;
}

/**
 * The Radar header strip — "This week (Mon 14 – Sun 20) · 8 h of 20 h"
 * (§10.4, RULE-20). The week is the CURRENT Mon–Sun week in Europe/London,
 * read by `staff_week_meter()` off the same helpers the per-row figures
 * use, so the strip and the cards cannot disagree about a cap.
 */
export interface WeekMeter {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Sunday, `YYYY-MM-DD`. */
  weekEnd: string;
  bookedHours: number;
  /** Null where there is no ceiling (RULE-20). */
  capHours: number | null;
  /** The worker's signed-off roles, sorted. */
  roles: string[];
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
    venueLat: coordinate(row['venue_lat']),
    venueLng: coordinate(row['venue_lng']),
    geofenceRadiusM: coordinate(row['geofence_radius_m']),
    homeLat: coordinate(row['home_lat']),
    homeLng: coordinate(row['home_lng']),
  }));
}

/** A numeric column that may be absent (older function body) or null. */
function coordinate(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function loadWeekMeter(): Promise<WeekMeter | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase.rpc('staff_week_meter');
  const row = data as Record<string, unknown> | null;
  if (!row || !row['weekStart']) return null;
  return {
    weekStart: row['weekStart'] as string,
    weekEnd: row['weekEnd'] as string,
    bookedHours: Number(row['bookedHours'] ?? 0),
    capHours:
      row['capHours'] === null || row['capHours'] === undefined ? null : Number(row['capHours']),
    roles: (row['roles'] as string[]) ?? [],
  };
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

/**
 * The Shifts tab's badge — §10.1's bottom navigation, `wireframes/staff/*.html`
 * ("Shifts · 3").
 *
 * One reading, used by every screen that renders the shell: the bookings
 * the UPCOMING part of My shifts shows — confirmed or worked, and still
 * current (`isCurrent()` in shifts/model.ts: up to the end of RULE-02's
 * check-out window, end + 4 h, or carrying an unresolved No check-out). It
 * is the list the badge points at, so the number and the cards behind it
 * cannot disagree — which they did while /invites counted confirmed only
 * and /radar counted both, and again while this counted every confirmed
 * booking ever made, so a shift from two weeks ago kept the badge up.
 * The collapsed "Past shifts" section is history and is not counted.
 */
export function shiftsBadge(
  bookings: readonly Pick<BookingRow, 'status' | 'endsAt' | 'noCheckoutOpen'>[],
  now: Date = new Date(),
): number {
  return bookings.filter((b) => isMine(b) && isCurrent(b, now)).length;
}

/**
 * The amber line an invitation carries BEFORE the worker taps Accept —
 * "Overlaps your confirmed Awards Night · Waiting Staff 16:00 – 02:00"
 * (wireframes/staff/invites.html, §3.4).
 *
 * The rule is `overlapVerdict` from `@thc/domain`, the same one
 * `accept_invite` re-checks in SQL: only CONFIRMED bookings count, two
 * windows that intersect conflict anywhere, and different venues need the
 * two-hour gap. This is a warning, not the gate — Accept stays live, and
 * the server's own refusal ("You're already booked for an overlapping
 * shift.") is still the answer if the worker presses on.
 *
 * `staff_bookings()` carries no venue id, so "the same venue" is read off
 * the venue's name and address together, which is what the card prints.
 */
export function overlapWarning(
  invite: Pick<BookingRow, 'bookingId' | 'startsAt' | 'endsAt' | 'venueName' | 'venueAddress'>,
  bookings: readonly Pick<
    BookingRow,
    | 'bookingId'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'venueName'
    | 'venueAddress'
    | 'eventTitle'
    | 'role'
  >[],
): string | null {
  const venueKey = (b: { venueName: string; venueAddress: string }) =>
    `${b.venueName}|${b.venueAddress}`;
  const candidate = {
    startsAt: invite.startsAt.getTime(),
    endsAt: invite.endsAt.getTime(),
    venueId: venueKey(invite),
  };
  for (const held of bookings) {
    if (held.status !== 'confirmed' || held.bookingId === invite.bookingId) continue;
    const verdict = overlapVerdict(candidate, {
      startsAt: held.startsAt.getTime(),
      endsAt: held.endsAt.getTime(),
      venueId: venueKey(held),
    });
    if (verdict === 'clear') continue;
    const window = `${formatTimeIn(held.startsAt, UK_ZONE)} – ${formatTimeIn(held.endsAt, UK_ZONE)}`;
    const which = `${held.eventTitle} · ${held.role} ${window}`;
    return verdict === 'intersects'
      ? `Overlaps your confirmed ${which}`
      : `Within 2 h of your confirmed ${which} at another venue`;
  }
  return null;
}
