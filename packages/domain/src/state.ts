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

export const BOOKING_STATUSES = ['invited', 'confirmed', 'worked', 'cancelled'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * §3.6. `worked` is reached from `confirmed` by the shift plus a check log.
 * A booking with no check-out stays `worked` with undetermined payable time;
 * that is a violation on the booking, not a separate state (RULE-02).
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  invited: ['confirmed', 'cancelled'],
  confirmed: ['worked', 'cancelled'],
  worked: [],
  cancelled: [],
};

/** Why a booking moved to `cancelled`. Self-cancel behaves differently (§3.6). */
export const CANCEL_REASONS = [
  'office_withdraw',
  'ready_cutoff',
  'self_cancel',
  'overlap_auto_withdraw',
  'event_cancelled',
  'compliance_block',
  'gdpr',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * Self-cancel permanently excludes the worker from that event: no self-apply,
 * no auto-assign invitation and no manual invitation (§3.6, RULE-04).
 */
export function excludesFromEvent(reason: CancelReason): boolean {
  return reason === 'self_cancel';
}

/** Blocked, inactive and removed workers get no invitations and are out of the scoring pool (§2.12). */
export function isBookable(status: StaffStatus): boolean {
  return status === 'compliant';
}

export function canTransitionStaff(from: StaffStatus, to: StaffStatus): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
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
