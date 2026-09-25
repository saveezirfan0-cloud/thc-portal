/**
 * The Staff App's three working screens — Scope §10.4.
 *
 * The engine that fills an event lives in `scoring.ts`, `autoAssign.ts` and
 * `supabase/migrations/20260921141500_auto_assign.sql`. This is the worker's
 * half: which card a booking becomes, which of the five buttons it carries,
 * and the exact words the app puts on a refusal.
 *
 * The rules that are easy to get wrong, and are therefore asserted:
 *
 *   - A confirmed booking is not one state but four. "Needs confirmation",
 *     "Time changed", "Today" and plain Confirmed are different cards with
 *     different buttons, and the first two are the ones a worker loses a
 *     shift by missing.
 *   - The day-before deadline is 12:00 UK the day BEFORE the shift starts
 *     (§3.5), which is not "24 hours before" and is not the viewer's noon.
 *   - Cancel shift is available strictly while MORE than 72 hours remain
 *     (RULE-04). At 72 hours exactly it is gone.
 *   - Three different dead ends produce three different static screens, with
 *     copy confirmed against the approved design (§10.4, 01.09.2026), and the
 *     No check-out one behaves differently from the other two: its card stays.
 */

import { UK_ZONE, formatDateIn, ukInstant } from './time';
import type { BookingStatus, CancelCause } from './state';

const HOUR_MS = 3_600_000;

/** RULE-04: strictly more than 72 hours must remain (§3.6, §10.4). */
export const SELF_CANCEL_WINDOW_HOURS = 72;

/** §3.5: the one hard deadline in the three-stage confirmation. */
export const READY_DEADLINE_UK = '12:00';

/** The same seven states as the §3.6 machine in state.ts — one list, not two. */
export type StaffBookingStatus = BookingStatus;

/** The fields of one row of `staff_bookings()` that any rule here reads. */
export interface StaffBooking {
  status: StaffBookingStatus;
  startsAt: Date;
  endsAt: Date;
  /** `bookings.confirmed_at` — decides whether the 12:00 deadline applies. */
  confirmedAt: Date | null;
  dayBeforeConfirmedAt: Date | null;
  onDayConfirmedAt: Date | null;
  reconfirmRequired: boolean;
  /** `bookings.cancel_cause` — CANCEL_CAUSES in state.ts; null while live. */
  cancelCause: CancelCause | null;
  eventCancelledAt: Date | null;
  /** RULE-02: check-out never pressed, four hours past the scheduled end. */
  noCheckoutOpen: boolean;
}

/** The civil date in a zone, `YYYY-MM-DD`. */
function civilDate(instant: Date, zone: string = UK_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * A `YYYY-MM-DD` civil date moved by whole calendar days. The arithmetic is
 * done in UTC, where every day is 24 hours long, so a DST changeover in
 * London cannot move it.
 */
function addCivilDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The UK calendar day before the one the shift starts on (§3.5). */
function ukDayBefore(startsAt: Date): string {
  return addCivilDays(civilDate(startsAt), -1);
}

/**
 * 12:00 UK on the day before the shift starts (§3.5).
 *
 * Built from the calendar, never by subtracting hours: take the UK civil
 * date the shift starts on, go back one calendar day, then name 12:00
 * Europe/London on that day. "The day before" is a calendar fact — a shift
 * starting at 02:00 has its deadline 38 hours earlier, one at 23:00 has it
 * 35 — and a fixed 24 h lands on the wrong day whenever a changeover sits in
 * between: 23:30 GMT on 25 Oct 2026 minus 24 h is 00:30 BST on the 25th, and
 * 00:30 BST on 30 Mar 2026 minus 24 h is 23:30 GMT on the 28th.
 *
 * The SQL half is `ready_deadline()`, which builds the same moment in
 * Europe/London and casts back. readyDeadline.vectors.json holds both to the
 * same cases (Vitest here, pgTAP 610 there).
 */
export function readyDeadline(startsAt: Date): Date {
  return ukInstant(ukDayBefore(startsAt), READY_DEADLINE_UK);
}

/** RULE-04's boundary: the last moment Cancel shift is offered. */
export function cancelDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - SELF_CANCEL_WINDOW_HOURS * HOUR_MS);
}

/**
 * "Available only while more than 72 hours remain" (§10.4). Strictly more:
 * at exactly 72 hours the button is gone, which is the reading the SQL takes
 * too (`starts_at - now() <= interval '72 hours'` refuses).
 */
export function canCancelShift(startsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() < cancelDeadline(startsAt).getTime();
}

export type StaticScreenCase = 'event_cancelled' | 'withdrawn' | 'no_checkout';

/**
 * The three dead ends (§10.4). Distinct copy for each, confirmed against the
 * approved design and by THC (correspondence, 01.09.2026).
 *
 * For the first two the card disappears from the list the moment the push
 * arrives, and this screen exists to catch a worker tapping a stale push
 * afterwards. The third is different: the booking stays `worked`, so the card
 * stays visible in My shifts and shows this in place of the check-out
 * controls until a manager resolves the violation.
 *
 * `/shifts/:id` renders it (apps/staff/app/shifts/[id]): `shiftPhase()` asks
 * this first, so a dead end outranks every button on the shift screen.
 *
 * `withdrawn` covers both ways the office takes a confirmed shift back: an
 * office Withdraw (N10b) and the 12:05 release of a worker who missed the
 * 12:00 "I'm ready" (N6b) — `wireframes/staff/shift-detail.html` (n2). The
 * worker's own cancel is not a dead end they need explaining to them.
 */
export function staticScreenCase(
  booking: Pick<StaffBooking, 'status' | 'cancelCause' | 'eventCancelledAt' | 'noCheckoutOpen'>,
): StaticScreenCase | null {
  if (booking.eventCancelledAt) return 'event_cancelled';
  if (booking.noCheckoutOpen) return 'no_checkout';
  if (
    booking.status === 'cancelled' &&
    (booking.cancelCause === 'office_withdraw' || booking.cancelCause === 'ready_cutoff')
  ) {
    return 'withdrawn';
  }
  return null;
}

export const SUPPORT_EMAIL = 'admin@thehospitalitycompany.co.uk';

/**
 * The words on each screen. `title` is the §10.4 sentence verbatim — for No
 * check-out that is the whole of "We didn't receive your check-out for this
 * shift — the office is following up with you directly.", which the
 * wireframe sets as the heading, so it has no separate body. `badge` and
 * `tone` are the wireframe's pill above the heading.
 */
export const STATIC_SCREEN_COPY: Record<
  StaticScreenCase,
  { badge: string; tone: 'coral' | 'amber'; title: string; body?: string }
> = {
  event_cancelled: {
    badge: 'Cancelled',
    tone: 'coral',
    title: 'This event has been cancelled',
    body: 'The office has cancelled this event. You are not expected at the venue.',
  },
  withdrawn: {
    badge: 'Withdrawn',
    tone: 'coral',
    // No body line: the wireframe (shift-detail n2) and §10.4 give only the
    // heading, and the same screen serves an office withdrawal AND the 12:05
    // release (`ready_cutoff`), so a sentence naming the office would be
    // untrue for half of its readers.
    title: 'You’ve been removed from this shift',
  },
  no_checkout: {
    badge: 'Awaiting the office',
    tone: 'amber',
    title:
      'We didn’t receive your check-out for this shift — the office is following up with you directly.',
  },
};

/** Every static screen carries the same contact line and one button (§10.4). */
export const STATIC_SCREEN_CONTACT_LEAD =
  'If you believe there has been an error, please contact us at:';
export const STATIC_SCREEN_CONTACT = `${STATIC_SCREEN_CONTACT_LEAD} ${SUPPORT_EMAIL}`;
export const STATIC_SCREEN_ACTION = 'OK, I understand';

export type ShiftCard =
  /** The shift starts today. Check-in lives inside this card (§5). */
  | 'today'
  /** Stage 2 is outstanding and the 12:00 deadline has not passed (§3.5). */
  | 'needs_ready'
  /** The office moved the time, venue or dress code — N11, Awaiting (§3.5). */
  | 'reconfirm'
  /** Confirmed, further out, cancellable while >72 h remain. */
  | 'confirmed'
  /** Already worked, or the window has passed. */
  | 'past';

/**
 * Which card a confirmed booking becomes (§10.4).
 *
 * Order matters and is the rule, not an implementation detail. A finished
 * shift is `past` whatever flags its row still carries. Below that, a changed
 * time outranks everything else the card could say: a worker who reads
 * "Today" and turns up at the old hour has been failed by the screen.
 * "Today" then outranks the day-before prompt, because once the day has
 * arrived the 12:00 deadline is behind them and stage 3 is the only thing
 * left to press.
 */
export function shiftCard(booking: StaffBooking, now: Date = new Date()): ShiftCard {
  // `past` outranks even a changed time. A stale reconfirm flag on a shift
  // that finished last month must not render a permanent "Confirm new time".
  if (now.getTime() >= booking.endsAt.getTime()) return 'past';
  if (booking.reconfirmRequired) return 'reconfirm';
  // Stage 3 belongs to a booking that is still awaiting the worker. One
  // already `worked` has been checked into, and confirm_on_day refuses it.
  if (booking.status !== 'confirmed') return 'today';
  if (civilDate(booking.startsAt) === civilDate(now)) return 'today';
  if (
    !booking.dayBeforeConfirmedAt &&
    readyCutoffApplies(booking.confirmedAt, booking.startsAt) &&
    now.getTime() >= readyDeadlineWindowOpens(booking.startsAt)
  ) {
    return 'needs_ready';
  }
  return 'confirmed';
}

/**
 * When the "I'm ready for tomorrow" card starts asking. N6 goes out on the
 * morning of the day before (§8), so the card is live from the start of that
 * UK day — not from the deadline itself, which is when it is already too late.
 * 00:00 UK on that calendar day, not "the deadline minus 12 h", which is
 * 23:00 or 01:00 when the clocks change that night.
 */
function readyDeadlineWindowOpens(startsAt: Date): number {
  return ukInstant(ukDayBefore(startsAt), '00:00').getTime();
}

/**
 * Is this booking subject to the 12:00 "I'm ready" deadline at all (§3.5)?
 * Only if it was confirmed before the deadline: a worker who accepted after
 * noon the day before, or on the day itself (RULE-08), never had the chance
 * to press it in time, so the 12:05 cutoff does not release them and the
 * app must not ask. No `confirmedAt` is treated as not subject. The SQL
 * half is `ready_cutoff_applies()` (20260927140300), which the cutoff and
 * N6 both read.
 */
export function readyCutoffApplies(confirmedAt: Date | null, startsAt: Date): boolean {
  return confirmedAt !== null && confirmedAt.getTime() < readyDeadline(startsAt).getTime();
}

/** True once the 12:05 cutoff would have released the booking (§3.5, N6b). */
export function readyDeadlinePassed(startsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= readyDeadline(startsAt).getTime();
}

/**
 * The refusals `accept_invite` can return, in the worker's words (§3.4, §10.4).
 *
 * `overlap`, `hours_limit` and `rtw_expired` leave the invitation live — the
 * office may move one of the two shifts, hours free up, the right to work is
 * renewed — so they read as a block, not a loss. `taken` is the only one that
 * has already closed the invitation. `rtw_expired` is its own answer since
 * 20260925100000: a worker past their right to work is not over their hours.
 */
export type AcceptRefusal =
  | 'taken'
  | 'overlap'
  | 'hours_limit'
  | 'rtw_expired'
  | 'not_invited'
  | 'event_cancelled'
  | 'event_ended'
  /** RULE-12, re-read at Accept (20260928110400): not compliant. */
  | 'blocked'
  /** A leaver or a removed account (§10.6, §1.7) — no candidate row at all. */
  | 'not_bookable'
  /** RULE-04: self-cancelled off this event. */
  | 'self_cancelled';

/**
 * RULE-03 (§3.4): "a popup appears in the app: 'Sorry, this shift has been
 * taken — someone confirmed first.'" — the scope's sentence, verbatim, as
 * the popup's headline. The body is the explanation the wireframe draws
 * under it (wireframes/staff/shifts.html): where the invitation went.
 */
export const TAKEN_POPUP_SENTENCE = 'Sorry, this shift has been taken — someone confirmed first.';

export const ACCEPT_REFUSAL_COPY: Record<AcceptRefusal, { title: string; body: string }> = {
  taken: {
    title: TAKEN_POPUP_SENTENCE,
    body: 'The invitation has moved to Closed and is no longer in your list.',
  },
  blocked: {
    title: 'Your account is blocked',
    body: 'You can’t accept shifts until your documents are back in order. Check the Documents tab.',
  },
  not_bookable: {
    title: 'This invitation is no longer open',
    body: 'Your account can’t take shifts. Please contact the office.',
  },
  self_cancelled: {
    title: 'This invitation is no longer open',
    body: 'You cancelled a confirmed shift on this event, so you can’t rejoin it (§3.6).',
  },
  overlap: {
    title: "You're already booked for an overlapping shift.",
    body: 'Only your confirmed bookings count — other open invitations don’t block you. Two confirmed shifts at the same venue back-to-back are fine; at different venues you need a 2-hour gap.',
  },
  hours_limit: {
    title: 'Limit Reached',
    body: 'This shift would take you over your weekly hours limit for that Mon–Sun week. The limit is calculated from your documents and can’t be changed in the app.',
  },
  rtw_expired: {
    title: 'Right to work needs updating',
    body: 'Your right-to-work evidence has expired for this date. Check the Documents tab — you can’t be booked until it’s renewed.',
  },
  not_invited: {
    title: 'This invitation is no longer open',
    body: 'It has already been answered or withdrawn.',
  },
  event_cancelled: {
    title: 'This event has been cancelled',
    body: 'The office has cancelled it. You are not expected at the venue.',
  },
  event_ended: {
    title: 'This shift has already ended',
    body: 'It finished before the invitation was answered, so the invitation has closed.',
  },
};

/** The refusals `apply_to_shift` can return (§10.4, Radar). */
export type ApplyRefusal =
  | 'full'
  | 'hours_limit'
  | 'rtw_expired'
  | 'already_has_booking'
  | 'event_cancelled'
  | 'shift_started'
  | 'blocked'
  | 'do_not_return'
  | 'self_cancelled'
  | 'booked_elsewhere'
  | 'wrong_role';

export const APPLY_REFUSAL_COPY: Record<ApplyRefusal, { title: string; body: string }> = {
  full: {
    title: 'Sorry, this shift is now full',
    body: 'It filled while you were looking. Your application wasn’t recorded. Keep an eye on Radar — new shifts are added regularly.',
  },
  hours_limit: {
    title: 'Limit Reached',
    body: 'This shift would take you over your weekly hours limit for that Mon–Sun week.',
  },
  rtw_expired: {
    title: 'Right to work needs updating',
    body: 'Your right-to-work evidence has expired for this date. Check the Documents tab — you can’t be booked until it’s renewed.',
  },
  already_has_booking: {
    title: 'You’re already on this shift',
    body: 'Check Shifts or Invites — it’s already in one of them.',
  },
  event_cancelled: {
    title: 'This event has been cancelled',
    body: 'It is no longer taking applications.',
  },
  shift_started: {
    title: 'This shift has already started',
    body: 'Applications close when the shift begins.',
  },
  blocked: {
    title: 'Your account is on hold',
    body: 'Check the Documents tab — something needs updating before you can be booked.',
  },
  do_not_return: {
    title: 'This shift isn’t available to you',
    body: 'Please contact the office if you think this is wrong.',
  },
  self_cancelled: {
    title: 'This shift isn’t available to you',
    body: 'You cancelled off this event earlier, so it is no longer open to you.',
  },
  booked_elsewhere: {
    title: 'You’re already booked at that time',
    body: 'Two confirmed shifts at the same venue back-to-back are fine; at different venues you need a 2-hour gap.',
  },
  wrong_role: {
    title: 'This shift isn’t one of your roles',
    body: 'Radar only shows the roles you’re signed off for.',
  },
};

/** One row of `staff_open_shifts()`, as Radar and Open shifts read it. */
export interface OpenShiftRow {
  shiftId: string;
  qualified: boolean;
  hoursLimit: boolean;
  appliedAt: Date | null;
  distanceKm: number | null;
  startsAt: Date;
}

export interface RadarGroups<T extends OpenShiftRow> {
  /** "You've worked here before" — wave 1, visible the moment the role opens. */
  qualified: T[];
  /** "Other clients" — only present once wave 1 is exhausted (RULE-17). */
  other: T[];
  /** "Applied · waiting for the office", pulled out of both groups (§10.4). */
  applied: T[];
}

/**
 * Radar's three groups (§10.4).
 *
 * An applied shift leaves its wave group and joins Applied rather than
 * appearing twice: the card "does not disappear — it stays visible with an
 * 'Applied' status, grouped together with the worker's other pending
 * applications under their own 'Applied' section".
 *
 * Within a group the order is the one the SQL already returned — closest
 * first — so this never re-sorts and cannot disagree with the km badges.
 */
export function radarGroups<T extends OpenShiftRow>(rows: readonly T[]): RadarGroups<T> {
  const groups: RadarGroups<T> = { qualified: [], other: [], applied: [] };
  for (const row of rows) {
    if (row.appliedAt) groups.applied.push(row);
    else if (row.qualified) groups.qualified.push(row);
    else groups.other.push(row);
  }
  return groups;
}

export const RADAR_GROUP_LABEL = {
  qualified: "You've worked here before",
  other: 'Other clients',
  applied: 'Applied · waiting for the office',
} as const;

/** "1.2 km" — the Radar badge. Below a kilometre it is still shown in km. */
export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return '—';
  return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

/** What the RPCs return about the Mon–Sun week a shift falls in (RULE-20). */
export interface CapFigures {
  /** Monday of the week the SECTION starts in, not the week today is in. */
  weekStart: string | null;
  /** Hours already confirmed, worked or closed in that week. */
  bookedHours: number | null;
  /** The calculated ceiling, or null where there is none. */
  capHours: number | null;
  /** This section's own length. */
  shiftHours: number;
}

/**
 * "You've worked 18 h in the week of Mon 21 — 18 h + 4 h is over your 20 h
 * limit" (§10.4, §4.4).
 *
 * The scope puts the numbers in front of the worker rather than the verdict
 * alone, and it is right to: the cap is calculated and never typed, so these
 * figures are the only way a worker can tell a term/holiday boundary from a
 * mistake by the office. Returns null where there is no ceiling to explain.
 */
export function explainLimit(figures: CapFigures): string | null {
  const { weekStart, bookedHours, capHours, shiftHours } = figures;
  if (capHours === null || bookedHours === null) return null;
  const week = weekStart ? ` in the week of ${formatWeekStart(weekStart)}` : '';
  const total = round1(bookedHours + shiftHours);
  return (
    `You've got ${formatHoursShort(bookedHours)}${week} — ` +
    `${formatHoursShort(bookedHours)} + ${formatHoursShort(shiftHours)} is ${total} h ` +
    `against your ${formatHoursShort(capHours)} limit.`
  );
}

/** "This week (Mon 14) · 8 h of 20 h" — the Radar header strip (§10.4). */
export function capMeter(figures: CapFigures): string | null {
  if (figures.capHours === null || figures.bookedHours === null) return null;
  return `${formatHoursShort(figures.bookedHours)} of ${formatHoursShort(figures.capHours)}`;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function formatHoursShort(hours: number): string {
  return `${round1(hours)} h`;
}

/** "Mon 21 Sep", the label §10.4 uses for a Mon–Sun week. */
function formatWeekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!));
  return formatDateIn(at, 'UTC', { weekday: 'short' });
}
