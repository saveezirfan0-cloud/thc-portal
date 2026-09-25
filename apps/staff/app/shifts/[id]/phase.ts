import {
  CHECK_IN_GRACE_MIN,
  CHECK_IN_OPENS_MIN,
  NO_CHECK_OUT_AFTER_MIN,
  addMinutes,
  staticScreenCase,
  turnedAwayMinutes,
} from '@thc/domain';
import type { StaticScreenCase } from '@thc/domain';
import type { ShiftDetail } from './types';

/**
 * What the shift screen is showing right now (§5.1, §10.4).
 *
 * This mirrors the gates in `check_in_decision` / `check_out_decision`
 * rather than re-deciding them: the server is what actually allows a press,
 * and a screen that disagreed would either offer a button that fails or
 * hide one that would have worked. What it adds is the states the server
 * has no opinion about — before the window opens, and after the shift is
 * closed — and the copy for each.
 *
 * The three §10.4 dead ends come first and are whole screens of their own —
 * no map, no check-in/out, no breaks: a cancelled event (N12), a booking the
 * office took back (N10b / N6b), and a shift locked for No check-out
 * (RULE-02). The rule for the first two and for a RAISED No check-out is
 * `staticScreenCase()` in @thc/domain; this adds the moment the check-out
 * button locks at end+4h, before the job has written the violation, so the
 * screen never shows a live check-out the server would refuse.
 */
export type ShiftPhase =
  | StaticScreenCase // 'event_cancelled' | 'withdrawn' | 'no_checkout' — static (§10.4)
  | 'before_window' // too early to check in
  | 'check_in' // the window is open
  | 'locked' // start+30 passed with no check-in (§5.1)
  | 'on_shift'
  | 'on_break'
  | 'closed' // checked out
  | 'turned_away'; // strict buffer, RULE-15 — "Thanks for coming" (§3.2)

const STATIC_PHASES: readonly ShiftPhase[] = ['event_cancelled', 'withdrawn', 'no_checkout'];

/** True for the three phases that replace the whole shift screen (§10.4). */
export function isStaticPhase(phase: ShiftPhase): phase is StaticScreenCase {
  return STATIC_PHASES.includes(phase);
}

/**
 * True for every phase with nothing live on it — the three §10.4 dead ends
 * and the turn-away. None of them asks for the worker's location, draws the
 * map or offers a button that talks to the server.
 */
export function isTerminalPhase(phase: ShiftPhase): boolean {
  return isStaticPhase(phase) || phase === 'turned_away';
}

/**
 * Whether `/shifts/:id` has anything to show for this booking at all.
 *
 * A booked shift (confirmed, worked, turned away) gets the shift screen; a
 * §10.4 dead end gets its static screen. Anything else — the worker's own
 * cancel, a declined or lapsed invitation, a pending application — is not a
 * shift of theirs, and offering it a check-in button would be offering a
 * press the server refuses (`booking_not_confirmed`).
 */
export function shiftScreenReachable(
  shift: Pick<ShiftDetail, 'status' | 'cancelCause' | 'eventCancelledAt' | 'noCheckoutOpen'>,
): boolean {
  if (shift.status === 'confirmed' || shift.status === 'worked' || shift.status === 'turned_away') {
    return true;
  }
  return (
    staticScreenCase({
      status: shift.status,
      cancelCause: shift.cancelCause,
      eventCancelledAt: shift.eventCancelledAt ? new Date(shift.eventCancelledAt) : null,
      noCheckoutOpen: shift.noCheckoutOpen,
    }) !== null
  );
}

export interface PhaseInput {
  shift: Pick<
    ShiftDetail,
    | 'startsAt'
    | 'endsAt'
    | 'confirmedAt'
    | 'checkInAt'
    | 'checkOutAt'
    | 'status'
    | 'cancelCause'
    | 'eventCancelledAt'
    | 'noCheckoutOpen'
  >;
  openBreak: boolean;
  now: Date;
}

export function shiftPhase({ shift, openBreak, now }: PhaseInput): ShiftPhase {
  const startsAt = new Date(shift.startsAt);
  const endsAt = new Date(shift.endsAt);

  const dead = staticScreenCase({
    status: shift.status,
    cancelCause: shift.cancelCause,
    eventCancelledAt: shift.eventCancelledAt ? new Date(shift.eventCancelledAt) : null,
    noCheckoutOpen: shift.noCheckoutOpen,
  });
  if (dead) return dead;

  // Audit D19: a worker turned away is done with this shift. Before this,
  // the phase fell through to the clock and a reload inside the window
  // offered Check in again — to a booking `attempt_check_in` now refuses.
  if (shift.status === 'turned_away') return 'turned_away';

  if (shift.checkOutAt) return 'closed';

  if (shift.checkInAt) {
    // RULE-02: four hours past the end the button locks and only a manager
    // can close the shift — whether or not a break was left running.
    if (now >= addMinutes(endsAt, NO_CHECK_OUT_AFTER_MIN)) return 'no_checkout';
    return openBreak ? 'on_break' : 'on_shift';
  }

  if (now < addMinutes(startsAt, -CHECK_IN_OPENS_MIN)) return 'before_window';

  const { locks } = checkInWindow(shift);
  return now >= locks ? 'locked' : 'check_in';
}

/**
 * The check-in window the screen quotes back: "Check-in window 16:30 –
 * 17:30". The lock, and its one exception: a booking confirmed AFTER the
 * shift had already started keeps its button until the shift ends (§3.4),
 * because a window measured from a start they were not booked for means
 * nothing — so the screen must not quote start+30 to them either.
 */
export function checkInWindow(shift: Pick<ShiftDetail, 'startsAt' | 'endsAt' | 'confirmedAt'>): {
  opens: Date;
  locks: Date;
  confirmedAfterStart: boolean;
} {
  const start = new Date(shift.startsAt);
  const confirmedAfterStart = shift.confirmedAt !== null && new Date(shift.confirmedAt) > start;
  return {
    opens: addMinutes(start, -CHECK_IN_OPENS_MIN),
    locks: confirmedAfterStart ? new Date(shift.endsAt) : addMinutes(start, CHECK_IN_GRACE_MIN),
    confirmedAfterStart,
  };
}

/**
 * RULE-15: whether a turn-away is paid the flat 4 h. The logged attempt
 * decides, not the reload; with no stamp (a database before 20260929130000)
 * the screen cannot vouch for the pay and says only what is certain.
 */
export function turnAwayPaid(
  shift: Pick<ShiftDetail, 'startsAt' | 'endsAt' | 'turnedAwayAt'>,
): boolean {
  if (!shift.turnedAwayAt) return false;
  return (
    turnedAwayMinutes(
      { startsAt: new Date(shift.startsAt), endsAt: new Date(shift.endsAt) },
      new Date(shift.turnedAwayAt),
    ) > 0
  );
}

/** The instant check-out locks and RULE-02 takes over: end + 4 h. */
export function checkOutLocksAt(endsAt: string): Date {
  return addMinutes(new Date(endsAt), NO_CHECK_OUT_AFTER_MIN);
}

/** Metres between two WGS-84 points — the same haversine the venue map uses. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** "You're 1.8 km from the venue" reads better than 1,800 m (§5.1 copy). */
export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`;
}
