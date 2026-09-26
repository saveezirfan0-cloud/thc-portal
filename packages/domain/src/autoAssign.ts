/**
 * Turning one role section's candidate pool into a round's invitations
 * (§3.4, §6).
 *
 * `auto_assign_candidates(shift)` in SQL answers who is eligible and gives
 * the five raw signals. The ranking is here, not there, because §6's
 * weights are one implementation shared by the engine and the event board:
 * the board shows the same order on hover, and two implementations would
 * eventually disagree about who is top of the list.
 *
 * This file is the decision layer between the two, and it is pure so that
 * the Edge Function driving the round can be plumbing. That matters here
 * more than usual: nothing in this repo type-checks or runs the Deno in
 * `supabase/functions` (docs/14 O5), so every judgement worth testing
 * belongs on this side of the boundary.
 */

import {
  DEFAULT_WEIGHTS,
  rankPool,
  type Candidate,
  type HardGate,
  type RankedCandidate,
  type ScoreInput,
  type ScoreWeights,
} from './scoring.ts';
import { withAvailability } from './availability.ts';
import { bookingReopenableBy } from './reopen.ts';

/**
 * One row of `auto_assign_candidates`. Postgres `numeric` arrives as a
 * string through PostgREST, and `distance_km` is null for a worker with no
 * usable home address, so nothing here may assume a JavaScript number.
 */
export interface CandidateRow {
  staff_id: string;
  /** Null for everyone in the pool; names the bar for everyone else. */
  gate: string | null;
  qualified: boolean;
  /** 'invited' | 'confirmed' | … when this worker already holds one. */
  booking_status: string | null;
  /**
   * That booking's `cancel_cause` once it has ended (20260930110000) — what
   * tells a slot somebody else took from an invitation the worker declined.
   * Optional so a row read before the column existed still parses.
   */
  booking_cause?: string | null;
  reliability: number | string | null;
  rating: number | string | null;
  distance_km: number | string | null;
  future_shifts: number | string | null;
  venue_times: number | string | null;
}

export interface RoundOptions {
  /** `allocation_per_hour` for the section: the size of one round (§3.4). */
  allocation: number;
  weights?: ScoreWeights;
  /**
   * Same-day escalation (§3.4): once a shift has started, "proximity to the
   * venue matters more than the match score". Within each wave the nearest
   * worker goes first; the score only breaks a tie. Waves still come first —
   * RULE-17's qualified-first holds in escalation too.
   */
  proximityFirst?: boolean;
  /**
   * ADR-0042: staff ids with a calendar entry overlapping this section
   * (`auto_assign_unavailable(shift)`). A hard gate for the machine — the
   * round never invites them — and nothing more: a manager may still
   * invite by hand, and open invitations are never withdrawn (§3.4).
   */
  unavailable?: Iterable<string>;
}

/**
 * A numeric that may arrive as a string, with an explicit fallback.
 *
 * `Number(null)` is 0, which is the trap this exists to avoid: a null
 * `distance_km` means "no usable home address", and scoring it as zero
 * kilometres would hand that worker full proximity marks and put them top
 * of the list. Every caller below passes the fallback that is *least*
 * favourable, so missing data never flatters a candidate.
 */
function num(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Far enough that proximityFactor clamps to zero, without being Infinity. */
const NO_KNOWN_DISTANCE_KM = 1_000;

/**
 * The five §6 inputs for one row, with the least favourable fallback for
 * anything missing. Exported so the event board can show the SAME figures
 * the score was computed from, rather than re-reading the raw row.
 */
export function candidateInput(row: CandidateRow): ScoreInput {
  return {
    reliability: num(row.reliability, 0),
    rating: num(row.rating, 0),
    distanceKm: num(row.distance_km, NO_KNOWN_DISTANCE_KM),
    // More future shifts scores lower, so unknown must mean "many".
    futureShifts: num(row.future_shifts, 5),
    venueTimes: num(row.venue_times, 0),
  };
}

function toCandidate<T>(row: CandidateRow, subject: T): Candidate<T> {
  return {
    subject,
    qualifiedAtClientAndRole: row.qualified,
    // rankPool drops anything carrying a gate. The cast is safe because
    // rankPool only checks for presence; the value is SQL's own wording.
    ...(row.gate ? { gate: row.gate as HardGate } : {}),
    input: candidateInput(row),
  };
}

/**
 * The whole ranked pool for one section — wave 1 first, then wave 2, each
 * by score — keeping each row as the subject so a screen can still read
 * its name, booking status and factors.
 *
 * This is what the event board's Potential pool shows (§3.3), and it is
 * the same ranking `selectInvitees` takes a round from, so the board and
 * the engine cannot disagree about who is top of the list. Gated rows are
 * dropped by `rankPool`; which booking statuses belong in the pool is the
 * caller's decision (the board keeps Radar applicants, a round does not).
 */
export function rankCandidateRows<R extends CandidateRow>(
  rows: readonly R[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): RankedCandidate<R>[] {
  return rankPool(
    rows.map((row) => toCandidate(row, row)),
    weights,
  );
}

/**
 * Whether an automatic round may invite this row at all, booking-wise: no
 * booking on the section, or an ended one that ended by circumstance
 * (`bookingReopenableBy` → 'anyone': a slot somebody else took, an
 * overlap auto-withdrawal, a block or leave cascade). An ended row that a
 * PERSON decided — declined, withdrawn by the worker or the office,
 * released at the 12:05 cutoff — is reopened only by the office's manual
 * invite or the worker's own application, never by a round (ADR-0037);
 * a self-cancel never (RULE-04, and it is gated `self_cancelled` anyway).
 */
export function roundMayInvite(
  row: Pick<CandidateRow, 'booking_status' | 'booking_cause'>,
): boolean {
  if (row.booking_status === null) return true;
  return bookingReopenableBy(row.booking_status, row.booking_cause ?? null) === 'anyone';
}

/**
 * Who this round invites, best first.
 *
 * Two filters before the ranking, and the second is the one that matters:
 *
 *   * Gated candidates are dropped — `rankPool` does that, and a gated
 *     worker is never scored at all (§3.4).
 *   * Anyone already holding a LIVE booking on this section, or an ended
 *     one a round may not reopen (`roundMayInvite`), is dropped here.
 *     `invite_worker` would refuse them anyway with `already_has_booking`,
 *     so this is not about correctness — it is about the round not
 *     spending its allocation on refusals. A section whose pool is mostly
 *     people it invited an hour ago would otherwise invite nobody new,
 *     which is the opposite of what an additive round is for.
 */
export function selectInvitees(
  rows: readonly CandidateRow[],
  { allocation, weights = DEFAULT_WEIGHTS, proximityFirst = false, unavailable = [] }: RoundOptions,
): string[] {
  if (allocation <= 0) return [];
  const open = withAvailability(rows, unavailable).filter(roundMayInvite);
  const ranked = rankPool(
    open.map((row) => toCandidate(row, row)),
    weights,
  );
  if (proximityFirst) {
    // Array.prototype.sort is stable, so equal distances keep rankPool's
    // score order.
    ranked.sort((a, b) =>
      a.wave !== b.wave
        ? a.wave - b.wave
        : candidateInput(a.subject).distanceKm - candidateInput(b.subject).distanceKm,
    );
  }
  return ranked.slice(0, Math.trunc(allocation)).map((r) => r.subject.staff_id);
}

/**
 * Booking statuses on THIS section that rule a worker out of an offer push
 * (ADR-0045). The offerer and anyone else already confirmed hold the shift;
 * a worked or turned-away row is history; a cancelled row is a worker who
 * left it — `take_offered_shift` refuses them `already_had_booking`, so a
 * push would only invite a refusal. An open invitation, a Radar application
 * or a closed offer can still take it (`invited`/`applied` → confirmed,
 * `closed` → applied → confirmed), so those are pushed like anyone else.
 */
const OFFER_EXCLUDED_BOOKINGS: ReadonlySet<string> = new Set([
  'confirmed',
  'worked',
  'turned_away',
  'cancelled',
]);

export interface OfferRoundOptions {
  /** `allocation_per_hour` for the section: the size of one OF1 round. */
  allocation: number;
  /** Staff already pushed this offer (`shift_offer_notices`): rounds are additive. */
  notified: Iterable<string>;
  /** ADR-0042: the calendar gate applies to offer pushes too. */
  unavailable?: Iterable<string>;
  weights?: ScoreWeights;
}

/**
 * Who this hour's OF1 push for an open pool offer goes to, best first
 * (ADR-0045, docs/19 §4). The same pool and the same order as an invitation
 * round — gated rows dropped, the calendar gate overlaid, wave 1 (qualified
 * at client + role, RULE-17) exhausted before wave 2, each by §6 score —
 * minus everyone already told about this offer, so each round reaches new
 * people and nobody is pushed twice.
 */
export function selectOfferRecipients(
  rows: readonly CandidateRow[],
  { allocation, notified, unavailable = [], weights = DEFAULT_WEIGHTS }: OfferRoundOptions,
): string[] {
  if (allocation <= 0) return [];
  const told = new Set(notified);
  const open = withAvailability(rows, unavailable).filter(
    (row) =>
      !told.has(row.staff_id) &&
      (row.booking_status === null || !OFFER_EXCLUDED_BOOKINGS.has(row.booking_status)),
  );
  return rankPool(
    open.map((row) => toCandidate(row, row)),
    weights,
  )
    .slice(0, Math.trunc(allocation))
    .map((r) => r.subject.staff_id);
}
