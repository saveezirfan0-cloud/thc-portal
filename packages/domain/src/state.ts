/**
 * State machines — Scope §2.12 (Staff.status) and §3.6 (Booking.status).
 *
 * This module is the single source of truth for which transitions exist.
 * The database repeats these rules in triggers, so an illegal transition is
 * rejected even if it never passes through this code (CLAUDE.md, docs/01 §3).
 */
import type { RtwCheckStatus } from './rtwCheck';

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
  // ADR-0039: the worker offered the shift up and a confirmed replacement
  // took it (take_offered_shift). Sets self_cancelled like a self-cancel.
  'handed_over',
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
 *
 * A completed hand-over does too (ADR-0039, Q15): offering a shift up is the
 * worker leaving it under the same 72 h boundary, and without the bar it
 * would be a way round RULE-04's exclusion. `take_offered_shift()` sets
 * `self_cancelled = true` on the original booking for exactly this reason.
 */
export function excludesFromEvent(cause: CancelCause): boolean {
  return cause === 'self_cancel' || cause === 'handed_over';
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
    readonly machine: 'staff' | 'booking' | 'rtw_check' | 'change_request' | 'shift_offer',
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

/**
 * The automated right-to-work check (§2.6, ADR-0025), one `rtw_checks` row
 * per run. The database holds the same edges in `rtw_check_transitions()`
 * and refuses any other status change in the `rtw_checks_state_guard`
 * trigger (20260928100000); `rtwCheck.sql.test.ts` holds the two equal.
 *
 *   queued → running     claimed by the runner (`rtw_check_claim()`)
 *   queued → failed      the document left review before it ran (verified or
 *                        rejected by hand, superseded, the profile rejected)
 *   running → queued     the check could not be completed; retry after the backoff
 *   running → passed     verified through the one Verify, system actor
 *   running → rejected   the worker re-enters (N8)
 *   running → needs_review  the Compliance queue, with a reason
 *   running → failed     the document left review while it ran
 *
 * `running → running` is a lease re-taken after a runner died mid-check;
 * staying in a status is not a transition. The four outcomes are terminal:
 * "Run check again" is a NEW row, so each run keeps its own record.
 */
export const RTW_CHECK_TRANSITIONS: Readonly<Record<RtwCheckStatus, readonly RtwCheckStatus[]>> = {
  queued: ['running', 'failed'],
  running: ['queued', 'passed', 'rejected', 'needs_review', 'failed'],
  passed: [],
  rejected: [],
  needs_review: [],
  failed: [],
};

export function canTransitionRtwCheck(from: RtwCheckStatus, to: RtwCheckStatus): boolean {
  return from === to || RTW_CHECK_TRANSITIONS[from].includes(to);
}

export function assertRtwCheckTransition(from: RtwCheckStatus, to: RtwCheckStatus): void {
  if (!canTransitionRtwCheck(from, to)) throw new IllegalTransitionError('rtw_check', from, to);
}

/**
 * The office takes a Radar application forward — `applied → confirmed`
 * (§3.3, §10.4, §8 N10). The TS half of `accept_application()`
 * (20260925100000), which is authoritative: it re-reads everything under a
 * row lock. This is the same decision, in the same order, for a screen that
 * wants to explain a refusal or a test that pins the order.
 *
 * `gate` is the auto-assign hard gate for this worker on this section
 * (`auto_assign_candidates`): `null` for none, `undefined` when the worker
 * has no candidate row at all (removed §1.7, left §10.6). Fill counts ONLY
 * confirmed and the buffer is absolute, so the role is full at
 * `headcount + buffer`.
 *
 * There is no Decline: §10.4 and §8 end an application only by N10 (taken
 * forward), N10c (the role filled), the worker withdrawing it, or N12 (the
 * event cancelled) — ADR-0023.
 */
export const APPLICATION_ACCEPT_REFUSALS = [
  'event_cancelled',
  'not_applied',
  'event_ended',
  'full',
  'not_bookable',
  'wrong_role',
  'do_not_return',
  'blocked',
  'self_cancelled',
  'booked_elsewhere',
  'rtw_expired',
  'hours_limit',
] as const;

export type ApplicationAcceptRefusal = (typeof APPLICATION_ACCEPT_REFUSALS)[number];

export interface ApplicationAcceptInput {
  status: BookingStatus;
  eventCancelled: boolean;
  shiftEndsAt: Date;
  confirmed: number;
  headcount: number;
  buffer: number;
  gate: string | null | undefined;
}

export type ApplicationAcceptOutcome =
  | { ok: true; to: 'confirmed'; fillsRole: boolean }
  | { ok: false; reason: ApplicationAcceptRefusal };

export function acceptApplication(
  input: ApplicationAcceptInput,
  now: Date = new Date(),
): ApplicationAcceptOutcome {
  if (input.eventCancelled) return { ok: false, reason: 'event_cancelled' };
  if (input.status !== 'applied') return { ok: false, reason: 'not_applied' };
  if (now.getTime() >= input.shiftEndsAt.getTime()) return { ok: false, reason: 'event_ended' };
  if (roleFilled(input.confirmed, input.headcount, input.buffer)) {
    return { ok: false, reason: 'full' };
  }
  if (input.gate === undefined) return { ok: false, reason: 'not_bookable' };
  if (input.gate !== null) {
    const gate = input.gate as ApplicationAcceptRefusal;
    return {
      ok: false,
      reason: (APPLICATION_ACCEPT_REFUSALS as readonly string[]).includes(gate)
        ? gate
        : 'not_bookable',
    };
  }
  assertBookingTransition('applied', 'confirmed');
  return {
    ok: true,
    to: 'confirmed',
    fillsRole: roleFilled(input.confirmed + 1, input.headcount, input.buffer),
  };
}

/**
 * §8 N10c: the moment a role is fully confirmed — headcount + buffer, only
 * confirmed counting — every still-pending application on it closes
 * (`closed`, cause `slot_taken`) and its worker is told the shift filled.
 * `close_filled_role_applications()` in the database.
 */
export function roleFilled(confirmed: number, headcount: number, buffer: number): boolean {
  return confirmed >= headcount + buffer;
}

/** The cause an application closes with when the role fills without it (N10c). */
export const APPLICATION_NOT_TAKEN_CAUSE = 'slot_taken' satisfies CancelCause;

/**
 * Request a change — name and photo (ADR-0038, docs/18 §3). One
 * `profile_change_requests` row per request. The database holds the same
 * edges in `profile_change_transitions()` and refuses any other status
 * change in the `profile_change_requests_state_guard` trigger
 * (20260930100100); changeRequest.vectors.json holds both.
 *
 *   pending → approved    the office approved it (office_decide_profile_change)
 *   pending → rejected    the office refused it, with a reason the worker sees
 *   pending → withdrawn   the worker withdrew it, or GDPR removal (§1.7)
 *
 * The three outcomes are terminal: "Request again" is a new row.
 */
export const CHANGE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_TRANSITIONS: Readonly<
  Record<ChangeRequestStatus, readonly ChangeRequestStatus[]>
> = {
  pending: ['approved', 'rejected', 'withdrawn'],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransitionChangeRequest(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return from === to || CHANGE_REQUEST_TRANSITIONS[from].includes(to);
}

export function assertChangeRequestTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): void {
  if (!canTransitionChangeRequest(from, to)) {
    throw new IllegalTransitionError('change_request', from, to);
  }
}

/**
 * Offer up a shift (ADR-0039, docs/18 §4). One `shift_offers` row per
 * offer. The database holds the same edges in `shift_offer_transitions()`
 * and refuses any other status change in the `shift_offers_state_guard`
 * trigger (20260930100100); shiftOffer.vectors.json holds both.
 *
 *   open → taken       a confirmed replacement took it (take_offered_shift)
 *   open → withdrawn   the worker withdrew the offer
 *   open → lapsed      it expired (start − 72 h, OF3), or the booking left
 *                      `confirmed` by another cause, or GDPR removal
 *   open → cancelled   the office declined a cover request (OF6)
 *
 * The four outcomes are terminal: offering again is a new row.
 */
export const SHIFT_OFFER_STATUSES = ['open', 'taken', 'withdrawn', 'lapsed', 'cancelled'] as const;

export type ShiftOfferStatus = (typeof SHIFT_OFFER_STATUSES)[number];

export const SHIFT_OFFER_TRANSITIONS: Readonly<
  Record<ShiftOfferStatus, readonly ShiftOfferStatus[]>
> = {
  open: ['taken', 'withdrawn', 'lapsed', 'cancelled'],
  taken: [],
  withdrawn: [],
  lapsed: [],
  cancelled: [],
};

/**
 * Who an offer is for. `pool` — every eligible worker, RULE-17 order;
 * `office` — a cover request inside 72 h, seen only by the office until it
 * opens it to the pool; `direct` — one named colleague (designed, not built:
 * settings.shift_offers_direct_enabled = false, Q17).
 */
export const SHIFT_OFFER_MODES = ['pool', 'office', 'direct'] as const;

export type ShiftOfferMode = (typeof SHIFT_OFFER_MODES)[number];

/**
 * The one mode change there is: the office opens a cover request to the
 * pool (`office_open_offer_to_pool`), and only while the offer is open.
 * `shift_offer_mode_transitions()` in SQL.
 */
export const SHIFT_OFFER_MODE_TRANSITIONS: Readonly<
  Record<ShiftOfferMode, readonly ShiftOfferMode[]>
> = {
  pool: [],
  office: ['pool'],
  direct: [],
};

export function canTransitionShiftOffer(from: ShiftOfferStatus, to: ShiftOfferStatus): boolean {
  return from === to || SHIFT_OFFER_TRANSITIONS[from].includes(to);
}

export function assertShiftOfferTransition(from: ShiftOfferStatus, to: ShiftOfferStatus): void {
  if (!canTransitionShiftOffer(from, to)) throw new IllegalTransitionError('shift_offer', from, to);
}

/** Whether an offer in `status` may move from mode `from` to mode `to`. */
export function canChangeShiftOfferMode(
  from: ShiftOfferMode,
  to: ShiftOfferMode,
  status: ShiftOfferStatus,
): boolean {
  if (from === to) return true;
  return status === 'open' && SHIFT_OFFER_MODE_TRANSITIONS[from].includes(to);
}
