/**
 * State machines — Scope §2.12 (Staff.status) and §3.6 (Booking.status).
 *
 * This module is the single source of truth for which transitions exist.
 * The database repeats these rules in triggers, so an illegal transition is
 * rejected even if it never passes through this code (CLAUDE.md, docs/01 §3).
 */

export const STAFF_STATUSES = [
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'contract',
  'compliant',
  'blocked',
  'rejected',
  'inactive',
  'removed',
] as const;

export type StaffStatus = (typeof STAFF_STATUSES)[number];

/**
 * §2.12. `removed` is terminal and irreversible (GDPR anonymisation).
 * `inactive` is the leaver state: entered only by the worker through the app
 * (§10.6) and left only by a manager pressing Reset to candidate (§9.6),
 * which returns the person to `interview_requested` on the same record.
 */
export const STAFF_TRANSITIONS: Readonly<Record<StaffStatus, readonly StaffStatus[]>> = {
  interview_requested: ['interview_completed', 'rejected', 'removed'],
  interview_completed: ['documents', 'rejected', 'removed'],
  documents: ['quiz', 'rejected', 'removed'],
  quiz: ['contract', 'rejected', 'removed'],
  contract: ['compliant', 'rejected', 'removed'],
  compliant: ['blocked', 'inactive', 'removed'],
  blocked: ['compliant', 'inactive', 'interview_requested', 'removed'],
  // Reset to candidate is the only way out of rejected (§9.6).
  rejected: ['interview_requested', 'removed'],
  // Reset to candidate is the only way out of inactive (§2.12).
  inactive: ['interview_requested', 'removed'],
  removed: [],
};

/**
 * §3.6, all seven values of the `booking_status` enum (0001_init.sql).
 *
 * `applied` is a Radar self-application (§10.4, RULE-08); `closed` is an
 * offer that died without ever being a booking — a slot someone else took
 * (§3.4), a Decline, a withdrawn application (§10.4); `turned_away` is the
 * strict-buffer refusal at check-in (RULE-15, §5.2).
 */
export const BOOKING_STATUSES = [
  'invited',
  'applied',
  'confirmed',
  'worked',
  'turned_away',
  'cancelled',
  'closed',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * §3.6. `worked` is reached from `confirmed` by the shift plus a check log.
 * A booking with no check-out stays `worked` with undetermined payable time;
 * that is a violation on the booking, not a separate state (RULE-02).
 *
 * The database holds the same edges in `booking_transitions()` and refuses
 * any other status change in the `bookings_state_guard` trigger
 * (20260924120000). Both sides are held to bookingState.vectors.json.
 * Staying in the same status is not a transition and is always allowed.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  // Accept (§3.6); Withdraw, overlap auto-withdraw, cascade, event cancelled;
  // slot taken or Decline (§3.4, §10.4).
  invited: ['confirmed', 'cancelled', 'closed'],
  // Taken forward (N10); cancelled with the event or a cascade; withdrawn by
  // the worker or not taken forward (N10c).
  applied: ['confirmed', 'cancelled', 'closed'],
  // Check-in (§3.6), buffer turn-away (RULE-15), or any cancel trigger.
  confirmed: ['worked', 'turned_away', 'cancelled'],
  worked: [],
  turned_away: [],
  cancelled: [],
  // §10.4: a dead offer may be applied for again on Radar.
  closed: ['applied'],
};

/**
 * Why a booking left the live states — `bookings.cancel_cause`, and the
 * only vocabulary for it (`bookings_cancel_cause_check`, 20260924120000).
 *
 * Each cause belongs to exactly one target status. `<cause>_invite` is the
 * invitation-or-application half of a §4.3 cascade, kept distinct so E8
 * lists only the confirmed shifts an event actually lost.
 */
export const CANCELLED_CAUSES = [
  'office_withdraw',
  'ready_cutoff',
  'self_cancel',
  'overlap_auto_withdraw',
  'event_cancelled',
  'blocked',
  'blocked_invite',
  'left',
  'left_invite',
  'gdpr',
  'gdpr_invite',
] as const;

export const CLOSED_CAUSES = ['slot_taken', 'declined', 'withdrawn_by_worker'] as const;

export const CANCEL_CAUSES = [...CANCELLED_CAUSES, ...CLOSED_CAUSES] as const;

export type CancelCause = (typeof CANCEL_CAUSES)[number];

export function isCancelCause(value: string | null | undefined): value is CancelCause {
  return (CANCEL_CAUSES as readonly string[]).includes(value ?? '');
}

/** The one status a cause may be written with. */
export function cancelCauseStatus(cause: CancelCause): 'cancelled' | 'closed' {
  return (CLOSED_CAUSES as readonly string[]).includes(cause) ? 'closed' : 'cancelled';
}

/**
 * Self-cancel permanently excludes the worker from that event: no self-apply,
 * no auto-assign invitation and no manual invitation (§3.6, RULE-04).
 */
export function excludesFromEvent(cause: CancelCause): boolean {
  return cause === 'self_cancel';
}

/** Blocked, inactive and removed workers get no invitations and are out of the scoring pool (§2.12). */
export function isBookable(status: StaffStatus): boolean {
  return status === 'compliant';
}

export function canTransitionStaff(from: StaffStatus, to: StaffStatus): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return from === to || BOOKING_TRANSITIONS[from].includes(to);
}

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether the office's Withdraw (§3.3) — or any other cancel — is still an
 * edge from this status. False once the worker has checked in (`worked`) or
 * been turned away: §3.6 has no way back out of either, and the database
 * refuses the update (bookings_state_guard), so the button is not offered.
 */
export function canCancelBooking(status: string): boolean {
  return isBookingStatus(status) && BOOKING_TRANSITIONS[status].includes('cancelled');
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: 'staff' | 'booking',
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${machine} transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertStaffTransition(from: StaffStatus, to: StaffStatus): void {
  if (!canTransitionStaff(from, to)) throw new IllegalTransitionError('staff', from, to);
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransitionBooking(from, to)) throw new IllegalTransitionError('booking', from, to);
}
