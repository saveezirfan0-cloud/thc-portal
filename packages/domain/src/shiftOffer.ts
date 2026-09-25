/**
 * Offer up a shift ("release to the pool") — ADR-0039, docs/18 §4 (an
 * addition to Scope v1.6: §3.6 cause `handed_over` and source `offer`,
 * RULE-04 §7, §10.4, §3.3, §3.4 offer rounds, §8 OF1–OF6, §9.12).
 *
 * The booking is released only when a confirmed replacement takes it. The
 * rules that are easy to get wrong, and are therefore asserted by
 * shiftOffer.vectors.json:
 *
 *   - A worker may offer to the pool only while MORE than 72 hours remain —
 *     exactly `canCancelShift()` (RULE-04). At 72 h exactly it is gone, and
 *     the offer itself lapses at start − 72 h (OF3), still booked.
 *   - The offerer stays confirmed until the take: fill, buffer, the client
 *     line-up are unchanged while an offer is open.
 *   - The taker passes every hard gate the auto-assign pool applies, by
 *     name, and RULE-17's order: an unqualified taker waits (`not_yet`)
 *     until wave 1 is exhausted.
 *   - Being marked unavailable (ADR-0036) does NOT refuse a take. The
 *     calendar gates what the machine does, never what the worker chooses.
 *   - A completed hand-over bars the offerer from the event like a
 *     self-cancel (`excludesFromEvent('handed_over')`, Q15).
 *
 * `take_offered_shift()` (Agent A, 20260930110100) is authoritative: it
 * re-reads everything under the section's row lock. This is the same
 * decision in the same order, for a screen explaining a refusal and a test
 * pinning the order.
 */

import { canCancelShift, cancelDeadline } from './staff';
import type { BookingStatus, ShiftOfferMode, ShiftOfferStatus } from './state';
import { CALENDAR_GATE } from './availability';

/**
 * RULE-04's boundary, reused: a pool offer is available exactly while Cancel
 * shift is (§10.4, strictly more than 72 hours).
 */
export function canOfferShift(startsAt: Date, now: Date = new Date()): boolean {
  return canCancelShift(startsAt, now);
}

/**
 * When an open offer stops being takeable. A worker's pool offer closes at
 * start − 72 h (`cancelDeadline`). A cover request the office opened to the
 * pool runs to the section's start — after that the same-day escalation job
 * owns the section.
 */
export function offerExpiresAt(startsAt: Date, openedByOffice = false): Date {
  return openedByOffice ? new Date(startsAt.getTime()) : cancelDeadline(startsAt);
}

/** Every refusal `take_offered_shift()` can give, in the order it checks. */
export const TAKE_OFFER_REFUSALS = [
  'event_cancelled',
  'offer_not_open',
  'offer_expired',
  'original_not_confirmed',
  'own_offer',
  'section_started',
  'not_bookable',
  'wrong_role',
  'do_not_return',
  'blocked',
  'self_cancelled',
  'overlap',
  'rtw_expired',
  'hours_limit',
  'already_had_booking',
  'not_yet',
] as const;

export type TakeOfferRefusal = (typeof TAKE_OFFER_REFUSALS)[number];

/**
 * The pool gates a take refuses on, by the name the worker is given. The
 * pool says `booked_elsewhere`; a take says `overlap`, the word `accept_invite`
 * uses for the same clash. Anything else unknown is `not_bookable`.
 */
const GATE_REFUSAL: Readonly<Record<string, TakeOfferRefusal>> = {
  wrong_role: 'wrong_role',
  do_not_return: 'do_not_return',
  blocked: 'blocked',
  self_cancelled: 'self_cancelled',
  booked_elsewhere: 'overlap',
  rtw_expired: 'rtw_expired',
  hours_limit: 'hours_limit',
};

/** The taker's own booking on this section, if any. */
export type TakerBookingStatus = BookingStatus | null;

export interface TakeOfferInput {
  eventCancelled: boolean;
  offerStatus: ShiftOfferStatus;
  expiresAt: Date;
  /** The offerer's booking — the one being handed over. */
  originalStatus: BookingStatus;
  offeredBy: string;
  taker: string;
  sectionStartsAt: Date;
  /**
   * The taker's gate from `auto_assign_candidates(shift)`: null for none,
   * undefined when the taker has no candidate row at all (removed, left).
   */
  gate: string | null | undefined;
  /** Qualified at this client AND role (RULE-17 wave 1). */
  qualified: boolean;
  /** `offer_wave1_exhausted(offer)`: every wave-1 candidate has been told. */
  wave1Exhausted: boolean;
  takerBookingStatus: TakerBookingStatus;
}

export type TakeOfferOutcome =
  | {
      ok: true;
      /** Where the taker's row comes from: a new row, or one revived. */
      takerFrom: 'none' | 'invited' | 'applied' | 'closed';
    }
  | { ok: false; reason: TakeOfferRefusal };

/** Booking rows on this section that mean the taker cannot take it again. */
const HAD_BOOKING: ReadonlySet<BookingStatus> = new Set([
  'confirmed',
  'worked',
  'turned_away',
  'cancelled',
]);

/**
 * Whether this worker may take this offer now, and if not, why — in the
 * order `take_offered_shift()` checks:
 * `event_cancelled` › `offer_not_open` › `offer_expired` ›
 * `original_not_confirmed` › `own_offer` › `section_started` › the gate by
 * name (`booked_elsewhere` → `overlap`) › `already_had_booking` › `not_yet`.
 */
export function takeOffer(input: TakeOfferInput, now: Date = new Date()): TakeOfferOutcome {
  if (input.eventCancelled) return { ok: false, reason: 'event_cancelled' };
  if (input.offerStatus !== 'open') return { ok: false, reason: 'offer_not_open' };
  if (now.getTime() >= input.expiresAt.getTime()) return { ok: false, reason: 'offer_expired' };
  if (input.originalStatus !== 'confirmed') return { ok: false, reason: 'original_not_confirmed' };
  if (input.taker === input.offeredBy) return { ok: false, reason: 'own_offer' };
  if (now.getTime() >= input.sectionStartsAt.getTime()) {
    return { ok: false, reason: 'section_started' };
  }
  if (input.gate === undefined) return { ok: false, reason: 'not_bookable' };
  // ADR-0036: the calendar never refuses the worker's own choice.
  if (input.gate !== null && input.gate !== CALENDAR_GATE) {
    return { ok: false, reason: GATE_REFUSAL[input.gate] ?? 'not_bookable' };
  }
  if (input.takerBookingStatus !== null && HAD_BOOKING.has(input.takerBookingStatus)) {
    return { ok: false, reason: 'already_had_booking' };
  }
  if (!input.qualified && !input.wave1Exhausted) return { ok: false, reason: 'not_yet' };
  const from = input.takerBookingStatus;
  return {
    ok: true,
    takerFrom: from === 'invited' || from === 'applied' || from === 'closed' ? from : 'none',
  };
}

export interface OfferForViewer {
  status: ShiftOfferStatus;
  mode: ShiftOfferMode;
  expiresAt: Date;
  offeredBy: string;
  targetStaffId?: string | null;
}

export interface OfferViewer {
  staffId: string;
  /** As `TakeOfferInput.gate`. */
  gate: string | null | undefined;
  qualified: boolean;
}

/**
 * Whether Radar's "Up for grabs" shows this offer to this worker (RULE-17
 * visibility, docs/18 §4). Never the offerer's own; never an `office`
 * cover request (the office has not opened it); a `direct` offer only to
 * its one colleague; a pool offer to wave 1 first and to everyone else once
 * wave 1 is exhausted. A gated worker never sees it — except for the
 * calendar gate, which does not stop a worker taking a shift.
 */
export function offerVisibleTo(
  offer: OfferForViewer,
  viewer: OfferViewer,
  wave1Exhausted: boolean,
  now: Date = new Date(),
): boolean {
  if (offer.status !== 'open') return false;
  if (now.getTime() >= offer.expiresAt.getTime()) return false;
  if (viewer.staffId === offer.offeredBy) return false;
  if (offer.mode === 'office') return false;
  if (viewer.gate === undefined) return false;
  if (viewer.gate !== null && viewer.gate !== CALENDAR_GATE) return false;
  if (offer.mode === 'direct') return viewer.staffId === offer.targetStaffId;
  return viewer.qualified || wave1Exhausted;
}
