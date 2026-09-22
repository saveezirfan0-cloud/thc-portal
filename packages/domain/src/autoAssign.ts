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
  type ScoreWeights,
} from './scoring.ts';

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

function toCandidate(row: CandidateRow): Candidate<string> {
  return {
    subject: row.staff_id,
    qualifiedAtClientAndRole: row.qualified,
    // rankPool drops anything carrying a gate. The cast is safe because
    // rankPool only checks for presence; the value is SQL's own wording.
    ...(row.gate ? { gate: row.gate as HardGate } : {}),
    input: {
      reliability: num(row.reliability, 0),
      rating: num(row.rating, 0),
      distanceKm: num(row.distance_km, NO_KNOWN_DISTANCE_KM),
      // More future shifts scores lower, so unknown must mean "many".
      futureShifts: num(row.future_shifts, 5),
      venueTimes: num(row.venue_times, 0),
    },
  };
}

/**
 * Who this round invites, best first.
 *
 * Two filters before the ranking, and the second is the one that matters:
 *
 *   * Gated candidates are dropped — `rankPool` does that, and a gated
 *     worker is never scored at all (§3.4).
 *   * Anyone already holding a booking on this section is dropped here.
 *     `invite_worker` would refuse them anyway with `already_has_booking`,
 *     so this is not about correctness — it is about the round not
 *     spending its allocation on refusals. A section whose pool is mostly
 *     people it invited an hour ago would otherwise invite nobody new,
 *     which is the opposite of what an additive round is for.
 */
export function selectInvitees(
  rows: readonly CandidateRow[],
  { allocation, weights = DEFAULT_WEIGHTS }: RoundOptions,
): string[] {
  if (allocation <= 0) return [];
  const open = rows.filter((row) => row.booking_status === null);
  return rankPool(open.map(toCandidate), weights)
    .slice(0, Math.trunc(allocation))
    .map((ranked) => ranked.subject);
}
