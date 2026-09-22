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

import { UK_ZONE } from './time';

const HOUR_MS = 3_600_000;

/** RULE-04: strictly more than 72 hours must remain (§3.6, §10.4). */
export const SELF_CANCEL_WINDOW_HOURS = 72;

/** §3.5: the one hard deadline in the three-stage confirmation. */
export const READY_DEADLINE_UK = '12:00';

export type StaffBookingStatus =
  'invited' | 'confirmed' | 'worked' | 'applied' | 'cancelled' | 'closed' | 'turned_away';

/** The fields of one row of `staff_bookings()` that any rule here reads. */
export interface StaffBooking {
  status: StaffBookingStatus;
  startsAt: Date;
  endsAt: Date;
  dayBeforeConfirmedAt: Date | null;
  onDayConfirmedAt: Date | null;
  reconfirmRequired: boolean;
  cancelCause: string | null;
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
 * 12:00 UK on the day before the shift starts (§3.5).
 *
 * Built by walking back from the start rather than subtracting a fixed
 * number of hours, because "the day before" is a calendar fact: a shift
 * starting at 02:00 has its deadline 38 hours earlier, and one starting at
 * 23:00 has it 35. The SQL half is `ready_deadline()`, which builds the same
 * moment in Europe/London and casts back, so both survive the BST boundary.
 */
export function readyDeadline(startsAt: Date): Date {
  const dayBefore = new Date(startsAt.getTime() - 24 * HOUR_MS);
  const [y, m, d] = civilDate(dayBefore).split('-').map(Number);
  // Noon has no DST ambiguity in the UK — the clocks move at 01:00 — so a
  // single correction pass resolves it exactly.
  const guess = Date.UTC(y!, m! - 1, d!, 12, 0, 0);
  const offset = ukOffsetMs(new Date(guess));
  return new Date(guess - offset);
}

function ukOffsetMs(instant: Date): number {
  const asUk = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: UK_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(instant)
      .replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6Z'),
  );
  return asUk.getTime() - instant.getTime();
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
 * NOT YET WIRED IN. `/shifts/:id` is the §5 on-shift screen, which already
 * renders the No check-out case in its own words. The other two need
 * `events.cancelled_at` and `bookings.cancel_cause` on that screen's
 * `ShiftDetail`, which is the `checkin` bot's loader — two columns and one
 * branch. This lives here, tested, so that change is a one-liner rather than
 * a second copy of the copy.
 */
export function staticScreenCase(booking: StaffBooking): StaticScreenCase | null {
  if (booking.eventCancelledAt) return 'event_cancelled';
  if (booking.noCheckoutOpen) return 'no_checkout';
  if (booking.status === 'cancelled' && booking.cancelCause === 'office_withdraw') {
    return 'withdrawn';
  }
  return null;
}

export const SUPPORT_EMAIL = 'admin@thehospitalitycompany.co.uk';

export const STATIC_SCREEN_COPY: Record<StaticScreenCase, { title: string; body: string }> = {
  event_cancelled: {
    title: 'This event has been cancelled',
    body: 'The office has cancelled this event. You are not expected at the venue.',
  },
  withdrawn: {
    title: "You've been removed from this shift",
    body: 'The office has withdrawn this booking. It no longer appears in your shifts.',
  },
  no_checkout: {
    title: 'We didn’t receive your check-out for this shift',
    body: 'The office is following up with you directly.',
  },
};

/** Every static screen carries the same contact line and one button (§10.4). */
export const STATIC_SCREEN_CONTACT = `If you believe there has been an error, please contact us at: ${SUPPORT_EMAIL}`;
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
 */
function readyDeadlineWindowOpens(startsAt: Date): number {
  return readyDeadline(startsAt).getTime() - 12 * HOUR_MS;
}

/** True once the 12:05 cutoff would have released the booking (§3.5, N6b). */
export function readyDeadlinePassed(startsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= readyDeadline(startsAt).getTime();
}

/**
 * The refusals `accept_invite` can return, in the worker's words (§3.4, §10.4).
 *
 * `overlap` and `hours_limit` leave the invitation live — the office may move
 * one of the two shifts, and hours free up — so both read as a block, not a
 * loss. `taken` is the only one that has already closed the invitation.
 */
export type AcceptRefusal = 'taken' | 'overlap' | 'hours_limit' | 'not_invited' | 'event_cancelled';

export const ACCEPT_REFUSAL_COPY: Record<AcceptRefusal, { title: string; body: string }> = {
  taken: {
    title: 'Sorry, this shift has been taken',
    body: 'Someone confirmed first. The invitation has moved to Closed and is no longer in your list.',
  },
  overlap: {
    title: "You're already booked for an overlapping shift.",
    body: 'Only your confirmed bookings count — other open invitations don’t block you. Two confirmed shifts at the same venue back-to-back are fine; at different venues you need a 2-hour gap.',
  },
  hours_limit: {
    title: 'Limit Reached',
    body: 'This shift would take you over your weekly hours limit for that Mon–Sun week. The limit is calculated from your documents and can’t be changed in the app.',
  },
  not_invited: {
    title: 'This invitation is no longer open',
    body: 'It has already been answered or withdrawn.',
  },
  event_cancelled: {
    title: 'This event has been cancelled',
    body: 'The office has cancelled it. You are not expected at the venue.',
  },
};

/** The refusals `apply_to_shift` can return (§10.4, Radar). */
export type ApplyRefusal =
  | 'full'
  | 'hours_limit'
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
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at);
}
