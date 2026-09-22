import { rankPool, showsUnderUnavailable } from '@thc/domain';
import type { Candidate, HardGate, RankedCandidate } from '@thc/domain';
import type { BoardEvent, BoardSection, CandidateRow, PoolPerson, RosterRow } from './types';

/**
 * The event board's rules (§3.3). Pure, because three of them are the ones
 * this screen exists to get right.
 */

/**
 * §3.3, and the rule most likely to be got wrong: a worker gated by
 * `wrong_role` produces NO row at all — not even under Unavailable. The
 * other five gates do appear there with their reason.
 *
 * The scope's reason is practical rather than tidy: in an agency of a
 * thousand workers, nearly everyone is the wrong role for any given
 * section, so listing them "would bury the section". `showsUnderUnavailable`
 * in @thc/domain is the single definition and this only applies it.
 */
export function unavailableRows(candidates: CandidateRow[]): CandidateRow[] {
  return candidates.filter((row) => row.gate !== null && showsUnderUnavailable(row.gate));
}

export const GATE_REASON: Record<HardGate, string> = {
  wrong_role: 'Not qualified for this role',
  blocked: 'Blocked — compliance',
  booked_elsewhere: 'Booked elsewhere',
  hours_limit: 'Weekly hours limit reached',
  self_cancelled: 'Rejected — self-cancelled (RULE-04)',
  do_not_return: 'Do not return at this client',
};

/**
 * The potential pool, ranked (§3.4, §6).
 *
 * Ranking is `rankPool`'s, not this file's: it already implements the
 * §6 weights AND RULE-17's wave ordering — every eligible wave-1 worker
 * before any wave-2 worker, whatever they score. A wave-2 worker on 94
 * is invited after a wave-1 worker on 61, and the board has to show that
 * order or a manager reading down the list will pick wrongly.
 *
 * Anyone who already holds a booking on this section is excluded: §3.3
 * says a worker already in Invited who also self-applies "is not
 * duplicated into Potential pool — the marker shows on their existing
 * Invited entry instead".
 */
export function rankedPool(
  candidates: CandidateRow[],
  booked: ReadonlySet<string>,
): RankedCandidate<CandidateRow>[] {
  const eligible: Candidate<CandidateRow>[] = candidates
    .filter((row) => row.gate === null && !booked.has(row.staff_id))
    .map((row) => ({
      subject: row,
      qualifiedAtClientAndRole: row.qualified,
      input: {
        reliability: Number(row.reliability),
        rating: Number(row.rating),
        distanceKm: Number(row.distance_km),
        futureShifts: Number(row.future_shifts),
        venueTimes: Number(row.venue_times),
      },
    }));
  return rankPool(eligible);
}

/**
 * §3.3: "Invited and Potential pool are shown only while the role actually
 * has open or invited slots to fill — once a role is fully confirmed and
 * stable (an Ongoing event with no shortfall, or a Completed / Cancelled
 * event), these two sections are hidden entirely, not just shown empty."
 *
 * And the exception, which is the half that is easy to drop: "If a
 * shortfall reopens on an already-Ongoing event … Invited and Potential
 * pool reappear for that role so the manager can fill it."
 *
 * So the test is the shortfall, not the clock — an Ongoing event with a
 * no-show has open slots again and gets its pool back. Only a Completed or
 * Cancelled event hides them unconditionally, because nothing can be
 * filled after the fact.
 */
export function showsFillingLists(event: BoardEvent, section: BoardSection): boolean {
  if (event.status === 'completed' || event.status === 'cancelled') return false;
  return section.open_slots > 0 || section.invited > 0;
}

/**
 * §3.3: "Where roles on the same event run at different times, the
 * sections are ordered by start time, earliest first, so the board reads
 * like the running order of the day."
 *
 * The query orders too. This is here as well because the rule is the
 * scope's and not the query's — a later refactor that changes how the
 * sections are fetched should not be able to silently reorder the day.
 */
export function byStartTime(a: BoardSection, b: BoardSection): number {
  const difference = a.starts_at.localeCompare(b.starts_at);
  return difference !== 0 ? difference : a.role_name.localeCompare(b.role_name);
}

/**
 * The §3.3 header line: "N confirmed · M invited · K open of H".
 *
 * The allocation is written `H (+B)`, never H + B as one number — the
 * buffer is absolute and displays separately everywhere in this product.
 */
export function fillLine(section: BoardSection): string {
  const allocation =
    section.buffer > 0 ? `${section.headcount} (+${section.buffer})` : `${section.headcount}`;
  return `${section.confirmed} confirmed · ${section.invited} invited · ${section.open_slots} open of ${allocation}`;
}

export function fillTone(section: BoardSection): 'green' | 'amber' | 'coral' {
  if (section.open_slots === 0) return 'green';
  // "Badly short" is more than half the role unfilled — the point at which
  // a manager has to do something other than wait for the next round.
  return section.open_slots * 2 > section.headcount ? 'coral' : 'amber';
}

/**
 * Confirmed and Invited, grouped for one section (§3.3).
 *
 * A no-show stays in Confirmed. §3.3 is explicit: the worker is "marked
 * with a 'No show' status badge and a 'Get back' action next to their
 * name, rather than moving to a separate list … so the manager immediately
 * sees who needs replacing, and whose show-rate will drop".
 *
 * `worked` and `closed` sit in Confirmed too. The shift happened; moving
 * them out would empty the roster of a finished event.
 */
export function confirmedRows(roster: RosterRow[], shiftId: string): RosterRow[] {
  return roster.filter(
    (row) => row.shift_id === shiftId && ['confirmed', 'worked', 'closed'].includes(row.status),
  );
}

export function invitedRows(roster: RosterRow[], shiftId: string): RosterRow[] {
  return roster.filter(
    (row) => row.shift_id === shiftId && (row.status === 'invited' || row.status === 'applied'),
  );
}

/** Every worker holding a live booking on the section — the pool excludes them. */
export function bookedOn(roster: RosterRow[], shiftId: string): Set<string> {
  return new Set(
    roster
      .filter((row) => row.shift_id === shiftId && row.status !== 'cancelled')
      .map((row) => row.staff_id),
  );
}

/**
 * The three-stage confirmation state a Confirmed card shows (§3.5).
 *
 * The order matters: a no-show is the most recent fact about the worker
 * and outranks how far through confirming they got.
 */
export function confirmationLine(row: RosterRow): string {
  if (row.no_show) return 'No show';
  if (row.reconfirm_required) {
    return row.reconfirm_reason
      ? `Awaiting re-confirmation — ${row.reconfirm_reason}`
      : 'Awaiting re-confirmation';
  }
  if (row.on_day_confirmed_at) return 'Confirmed on the day';
  if (row.day_before_confirmed_at) return 'Ready — confirmed the day before';
  if (row.confirmed_at) return 'Accepted — not yet ready';
  return 'Confirmed';
}

/** "Applied 2h ago" (§3.3). Relative, because recency is the whole signal. */
export function appliedAgo(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60000));
  if (minutes < 60) return `Applied ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Applied ${hours}h ago`;
  return `Applied ${Math.floor(hours / 24)}d ago`;
}

export type PoolSort = 'rank' | 'applied';

/**
 * §3.3 lets the manager "sort/filter the pool by application status", and
 * is equally clear that "the pool's existing ranking and search stay
 * intact alongside this". So sorting by applied does not re-rank: it
 * lifts the self-applicants to the top and leaves both groups in the
 * order RULE-17 and §6 put them.
 */
export function sortPool(
  rows: RankedCandidate<CandidateRow>[],
  sort: PoolSort,
  appliedAt: ReadonlyMap<string, string>,
): RankedCandidate<CandidateRow>[] {
  if (sort === 'rank') return rows;
  const applied = (row: RankedCandidate<CandidateRow>) => appliedAt.has(row.subject.staff_id);
  return [...rows].sort((a, b) => Number(applied(b)) - Number(applied(a)));
}

export function poolSearch(
  rows: RankedCandidate<CandidateRow>[],
  people: Record<string, PoolPerson>,
  query: string,
): RankedCandidate<CandidateRow>[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) => {
    const person = people[row.subject.staff_id];
    if (!person) return false;
    return (
      person.display_name.toLowerCase().includes(needle) ||
      String(person.employee_id ?? '').includes(needle)
    );
  });
}
