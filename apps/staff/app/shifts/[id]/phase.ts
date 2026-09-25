import {
  CHECK_IN_GRACE_MIN,
  CHECK_IN_OPENS_MIN,
  NO_CHECK_OUT_AFTER_MIN,
  addMinutes,
  staticScreenCase,
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
/**
 * The static screens: §10.4's three dead ends, and a shift the worker
 * handed over to someone else (ADR-0039 — `cancel_cause = 'handed_over'`).
 * The fourth lives here rather than in `staticScreenCase()`, which Phase 0
 * left unchanged on purpose (docs/18 §8): it is this screen's case only.
 */
export type StaticPhase = StaticScreenCase | 'handed_over';

export type ShiftPhase =
  | StaticPhase // 'event_cancelled' | 'withdrawn' | 'no_checkout' | 'handed_over' — static
  | 'before_window' // too early to check in
  | 'check_in' // the window is open
  | 'locked' // start+30 passed with no check-in (§5.1)
  | 'turned_away' // strict buffer: past the headcount (§3.2, RULE-15)
  | 'on_shift'
  | 'on_break'
  | 'closed'; // checked out

const STATIC_PHASES: readonly ShiftPhase[] = [
  'event_cancelled',
  'withdrawn',
  'no_checkout',
  'handed_over',
];

/**
 * True for the phases that replace the whole shift screen: §10.4's three
 * and the hand-over (ADR-0039).
 */
export function isStaticPhase(phase: ShiftPhase): phase is StaticPhase {
  return STATIC_PHASES.includes(phase);
}

/** ADR-0039: the worker offered this shift up and somebody took it. */
function handedOver(shift: Pick<ShiftDetail, 'status' | 'cancelCause'>): boolean {
  return shift.status === 'cancelled' && shift.cancelCause === 'handed_over';
}

/**
 * Every phase with nothing to press and no map: the three §10.4 dead ends
 * and the §3.2 turn-away. None of them asks for the worker's location.
 */
export function isEndScreen(phase: ShiftPhase): boolean {
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
  // A stale OF2 push, or the worker's own history: say what happened to it.
  if (handedOver(shift)) return true;
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
  if (handedOver(shift)) return 'handed_over';

  // §3.2 strict buffer: the attempt was turned away and the booking is
  // terminal. "Thanks for coming" replaces the shift, however late the
  // worker comes back to it — the check-in button is not offered again.
  if (shift.status === 'turned_away') return 'turned_away';

  if (shift.checkOutAt) return 'closed';

  if (shift.checkInAt) {
    // RULE-02: four hours past the end the button locks and only a manager
    // can close the shift — whether or not a break was left running.
    if (now >= addMinutes(endsAt, NO_CHECK_OUT_AFTER_MIN)) return 'no_checkout';
    return openBreak ? 'on_break' : 'on_shift';
  }

  if (now < addMinutes(startsAt, -CHECK_IN_OPENS_MIN)) return 'before_window';

  // The lock, and its one exception: a booking confirmed AFTER the shift
  // had already started keeps its button until the shift ends, because a
  // window measured from a start they were not booked for means nothing.
  const confirmedAfterStart = shift.confirmedAt !== null && new Date(shift.confirmedAt) > startsAt;
  const locksAt = confirmedAfterStart ? endsAt : addMinutes(startsAt, CHECK_IN_GRACE_MIN);
  return now >= locksAt ? 'locked' : 'check_in';
}

/**
 * §3.2: did `attempt_check_in()` just turn this press away? Its reply
 * carries the decision and RULE-15's minutes for the logged attempt
 * (`turnAwayPayMin`: 240 inside the grace, 0 after it), which is all the
 * turn-away screen needs until the refreshed row says the same thing.
 * Anything else — checked in, out of radius, locked — is not a turn-away.
 */
export function turnedAwayReply(reply: Record<string, unknown>): { payMin: number | null } | null {
  if (reply['decision'] !== 'turned_away') return null;
  const payMin = reply['turnAwayPayMin'];
  return { payMin: payMin === null || payMin === undefined ? null : Number(payMin) };
}

/** The check-in window the screen quotes back: "Check-in window 16:30 – 17:30". */
export function checkInWindow(startsAt: string): { opens: Date; locks: Date } {
  const start = new Date(startsAt);
  return {
    opens: addMinutes(start, -CHECK_IN_OPENS_MIN),
    locks: addMinutes(start, CHECK_IN_GRACE_MIN),
  };
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
