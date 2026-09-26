import {
  NO_CHECK_OUT_AFTER_MIN,
  addMinutes,
  shiftCard,
  ukToday,
  type ShiftCard,
  type StaffBooking,
} from '@thc/domain';

/**
 * My shifts' pure presentation rules — Scope §10.4, wireframes/staff/shifts.html.
 *
 * `staff_bookings()` returns every booking the worker has ever had, sorted
 * by start (20260922140000), and it has to: a stale push must still find its
 * row. The LIST is what decides what is current, and until this file it did
 * not — a shift from two weeks ago sorted above today's, still wearing the
 * green "Confirmed" pill, and the nav badge counted it.
 *
 * Nothing here is a new rule. The cut-off is RULE-02's check-out window
 * (`NO_CHECK_OUT_AFTER_MIN`, end + 4 h): while a worker can still press
 * check-out the shift is theirs to act on, so it stays in the list; after it
 * the shift is history. The card state is `shiftCard()` from @thc/domain,
 * with the three ended cases the domain folds into `past` told apart,
 * because they read differently to a worker.
 *
 * The collapsed "Past shifts" section below the upcoming list is
 * ADR-0048 (docs/adr/0048-past-shifts-section.md): the wireframe draws only
 * the live cards, and history is one tap away rather than in the way.
 */

/** The statuses My shifts shows at all: booked, or under way / worked. */
export function isMine(booking: Pick<StaffBooking, 'status'>): boolean {
  return booking.status === 'confirmed' || booking.status === 'worked';
}

/** RULE-02: the moment check-out locks and the No check-out job may run. */
export function checkOutClosesAt(booking: Pick<StaffBooking, 'endsAt'>): Date {
  return addMinutes(booking.endsAt, NO_CHECK_OUT_AFTER_MIN);
}

/**
 * Still in the upcoming list. Everything up to the end of the check-out
 * window, and — whatever the clock says — a booking carrying an unresolved
 * No check-out: §10.4 says that card "does NOT disappear … it remains
 * visible in My shifts … until a manager resolves the violation".
 */
export function isCurrent(
  booking: Pick<StaffBooking, 'endsAt' | 'noCheckoutOpen'>,
  now: Date = new Date(),
): boolean {
  return booking.noCheckoutOpen || now.getTime() < checkOutClosesAt(booking).getTime();
}

export type ShiftGroup = 'earlier' | 'today' | 'tomorrow' | 'this_week' | 'later';

export const SHIFT_GROUP_LABEL: Record<ShiftGroup, string> = {
  // An overnight shift from yesterday still inside its check-out window, or
  // a No check-out awaiting the office. Rare, and not "Today".
  earlier: 'Earlier',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  later: 'Later',
};

const GROUP_ORDER: readonly ShiftGroup[] = ['earlier', 'today', 'tomorrow', 'this_week', 'later'];

/** A `YYYY-MM-DD` civil date moved by whole days, in UTC so DST cannot move it. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Sunday of the Mon–Sun week `isoDate` falls in — the RULE-20 week. */
function weekEnd(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, weekday === 0 ? 0 : 7 - weekday);
}

/**
 * Which header a shift sits under, by the Europe/London calendar day it
 * STARTS on (the day the card's UK line prints). "This week" is the rest of
 * the current Mon–Sun week after tomorrow — the same week the hours meter
 * above the list measures — so on a Saturday it is empty and Monday's shift
 * is Later.
 */
export function shiftGroup(startsAt: Date, now: Date = new Date()): ShiftGroup {
  const day = ukToday(startsAt);
  const today = ukToday(now);
  if (day < today) return 'earlier';
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day <= weekEnd(today)) return 'this_week';
  return 'later';
}

export interface MyShifts<T> {
  /** Non-empty groups, in reading order, each soonest first. */
  upcoming: { group: ShiftGroup; label: string; bookings: T[] }[];
  /** Past the check-out window, most recent first. */
  past: T[];
  /** Every upcoming booking — what the badge counts. */
  upcomingCount: number;
}

/** Split and group the list (§10.4). Sorted here, not trusted from SQL. */
export function myShifts<T extends StaffBooking>(
  bookings: readonly T[],
  now: Date = new Date(),
): MyShifts<T> {
  const mine = bookings.filter(isMine);
  const byStart = (a: T, b: T) => a.startsAt.getTime() - b.startsAt.getTime();
  const current = mine.filter((b) => isCurrent(b, now)).sort(byStart);
  const past = mine.filter((b) => !isCurrent(b, now)).sort((a, b) => byStart(b, a));

  const buckets = new Map<ShiftGroup, T[]>();
  for (const booking of current) {
    const group = shiftGroup(booking.startsAt, now);
    buckets.set(group, [...(buckets.get(group) ?? []), booking]);
  }
  return {
    upcoming: GROUP_ORDER.filter((g) => buckets.has(g)).map((group) => ({
      group,
      label: SHIFT_GROUP_LABEL[group],
      bookings: buckets.get(group)!,
    })),
    past,
    upcomingCount: current.length,
  };
}

/**
 * The card a My shifts booking becomes. `shiftCard()` decides every live
 * case; this only splits its `past`, which is one word for three things a
 * worker must read differently:
 *
 *   - `no_checkout`: RULE-02 raised — the §10.4 static line, amber.
 *   - `not_checked_in`: the section ended and the booking is still
 *     `confirmed`. There is no check-in on it, so it is NOT "Confirmed" any
 *     more; a No-show is a violation, not a status (§3.6, BG-03), and
 *     `staff_bookings()` does not say whether one was raised, so the card
 *     says only what is certain.
 *   - `ended`: checked in (`worked`), inside the check-out window.
 */
export type MyShiftCard = Exclude<ShiftCard, 'past'> | 'no_checkout' | 'not_checked_in' | 'ended';

export function myShiftCard(booking: StaffBooking, now: Date = new Date()): MyShiftCard {
  if (booking.noCheckoutOpen) return 'no_checkout';
  const card = shiftCard(booking, now);
  if (card !== 'past') return card;
  return booking.status === 'confirmed' ? 'not_checked_in' : 'ended';
}
