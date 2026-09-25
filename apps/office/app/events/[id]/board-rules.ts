/**
 * The pure rules behind the event board — Scope §1.7, §3.2, §3.3, §3.4,
 * §3.6, §5.2, RULE-01.
 *
 * Kept apart from `board-data.ts` (which needs the server-only database
 * client) and `actions.ts` (a `'use server'` module may export only async
 * functions), so every rule here has a Vitest vector.
 */

import {
  type CancelCause,
  type EventStatus,
  HOLIDAY_RATE,
  UK_ZONE,
  excludesFromEvent,
  formatTimeIn,
  isCancelCause,
  ukRoleWindow,
} from '@thc/domain';

// ---------------------------------------------------------------------
// §1.7 — a removed worker's row stays, labelled "Deleted account #id"
// ---------------------------------------------------------------------

export interface StaffNameRow {
  first_name: string;
  last_name: string;
  removed_at: string | null;
  employee_id: number | null;
}

/**
 * "Grace L." for a live worker; "Deleted account #1042" once GDPR-removed
 * (`remove_worker()` wipes the names to "Deleted" / "account", and the SQL
 * views label the row with `deleted_account_label(employee_id)`). The row
 * is never filtered out — the headcount would be skewed (event-board.html:266).
 */
export function personLabel(row: StaffNameRow): { name: string; deleted: boolean } {
  if (row.removed_at) {
    return { name: `Deleted account #${row.employee_id ?? 'unknown'}`, deleted: true };
  }
  return { name: `${row.first_name} ${row.last_name.charAt(0)}.`, deleted: false };
}

// ---------------------------------------------------------------------
// §3.3 / §3.6 — what a cancelled booking says under Unavailable
// ---------------------------------------------------------------------

/**
 * The reason a worker with a cancelled booking is listed under Unavailable,
 * or null when they are not listed at all.
 *
 * Only `self_cancel` is RULE-04's permanent exclusion ("rejected —
 * self-cancelled"); an overlap withdrawal is "booked elsewhere" (§3.4). A
 * booking the office withdrew, the 12:05 cutoff released (§3.5), the
 * event's own cancellation, a GDPR removal or a leaver is not a reason the
 * worker cannot be booked here again, so it produces no row. Blocked is a
 * live gate the candidate read owns; the cancelled row alone says nothing
 * about whether the block still stands.
 */
export function unavailableGate(
  cause: string | null,
): 'self_cancelled' | 'booked_elsewhere' | null {
  if (!isCancelCause(cause)) return null;
  if (excludesFromEvent(cause as CancelCause)) return 'self_cancelled';
  if (cause === 'overlap_auto_withdraw') return 'booked_elsewhere';
  return null;
}

// ---------------------------------------------------------------------
// §3.4 — the Auto-assign switch is a live control, not a creation flag
// ---------------------------------------------------------------------

/**
 * §3.4: "It can be turned off at event or role level"; the wireframe keeps
 * the switch through the Ongoing state (escalation runs during the event).
 * A completed or cancelled event has nothing left to assign.
 */
export function canToggleAutoAssign(status: EventStatus): boolean {
  return status === 'upcoming' || status === 'ongoing';
}

// ---------------------------------------------------------------------
// §3.3 — a row's pill and stamps, from the check-in record
// ---------------------------------------------------------------------

export interface RowRecord {
  status: string;
  noShow: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  /** RULE-01: [check-in, check-out] ∩ [start, end], breaks off; null until settled. */
  payableMin: number | null;
  unpaidBreakMin: number;
  minutesLate: number | null;
  leftEarly: boolean;
  /** An open or resolved No check-out violation, or null. */
  noCheckout: { id: string; resolved: boolean } | null;
}

export type RowPill =
  | { kind: 'no_show' }
  | { kind: 'on_shift' }
  | { kind: 'checked_out' }
  | { kind: 'no_checkout' }
  | null;

/**
 * docs/07's monitor vocabulary on the board: On shift green while checked
 * in with no check-out; "Checked out HH:MM" neutral once out; No check-out
 * coral while the violation is open; No show coral. Confirmed with no
 * arrival yet carries nothing but the sub-line.
 */
export function rowPill(record: RowRecord): RowPill {
  if (record.noShow) return { kind: 'no_show' };
  if (!record.checkInAt) return null;
  if (record.checkOutAt) return { kind: 'checked_out' };
  if (record.noCheckout && !record.noCheckout.resolved) return { kind: 'no_checkout' };
  return { kind: 'on_shift' };
}

/**
 * "payable 8.0 h · −0:20 break", "payable 6.3 h · Late 12 min",
 * "payable 3.7 h · no 4 h floor", or "payable pending" while a No check-out
 * is unresolved (event-board.html:314-330). Nothing until there is a
 * check-in.
 */
export function payableLine(record: RowRecord): string | null {
  if (!record.checkInAt) return null;
  if (record.noCheckout && !record.noCheckout.resolved) return 'payable pending';
  if (record.payableMin === null) return null;
  const parts = [`payable ${(record.payableMin / 60).toFixed(1)} h`];
  if (record.unpaidBreakMin > 0) parts.push(`−${formatMinutes(record.unpaidBreakMin)} break`);
  if (record.minutesLate !== null && record.minutesLate > 0) {
    parts.push(`Late ${record.minutesLate} min`);
  }
  if (record.leftEarly) parts.push('no 4 h floor');
  return parts.join(' · ');
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------
// §3.3 — the Completed header's Result line
// ---------------------------------------------------------------------

export interface ResultInput {
  sections: {
    payRate: number;
    chargeRate: number;
    confirmed: RowRecord[];
  }[];
}

export interface EventResult {
  worked: number;
  noShows: number;
  noCheckoutsPending: number;
  payableHours: number;
  /** Pence. Charge is payable hours × charge rate; pay carries holiday (§9.8). */
  chargePence: number;
  marginPence: number;
}

/**
 * "18 worked · 1 no-show · 1 no check-out (pending) · 112.4 payable h ·
 * charge £2,714 · margin £866" (event-board.html:303). A worker with a
 * pending No check-out counts as worked but contributes no hours yet
 * (RULE-02: never a guessed figure).
 */
export function eventResult(input: ResultInput): EventResult {
  let worked = 0;
  let noShows = 0;
  let noCheckoutsPending = 0;
  let payableMin = 0;
  let chargePence = 0;
  let payPence = 0;

  for (const section of input.sections) {
    for (const row of section.confirmed) {
      if (row.noShow) {
        noShows += 1;
        continue;
      }
      if (!row.checkInAt) continue;
      worked += 1;
      if (row.noCheckout && !row.noCheckout.resolved) {
        noCheckoutsPending += 1;
        continue;
      }
      const minutes = row.payableMin ?? 0;
      payableMin += minutes;
      chargePence += Math.round((minutes / 60) * section.chargeRate * 100);
      payPence += Math.round((minutes / 60) * section.payRate * 100 * (1 + HOLIDAY_RATE));
    }
  }

  return {
    worked,
    noShows,
    noCheckoutsPending,
    payableHours: Number((payableMin / 60).toFixed(1)),
    chargePence,
    marginPence: chargePence - payPence,
  };
}

export function formatResult(result: EventResult): string {
  const gbp = (pence: number) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    }).format(pence / 100);
  const parts = [`${result.worked} worked`, `${result.noShows} no-show`];
  if (result.noCheckoutsPending > 0) {
    parts.push(`${result.noCheckoutsPending} no check-out (pending)`);
  }
  parts.push(`${result.payableHours} payable h`, `charge ${gbp(result.chargePence)}`);
  return `${parts.join(' · ')} · margin ${gbp(result.marginPence)}`;
}

// ---------------------------------------------------------------------
// §3.3 — Cancel event's counts, broken out as the modal lists them
// ---------------------------------------------------------------------

export interface CancelCounts {
  confirmed: number;
  invited: number;
  applied: number;
}

/**
 * "13 confirmed, 7 invited and 2 open Radar applicants" (event-board.html:
 * 361). A checked-in (`worked`) booking is not cancelled (§3.6) and is not
 * counted; a no-show still holds a confirmed booking and is.
 */
export function cancelCounts(
  sections: { confirmed: { status: string }[]; invited: unknown[]; applied: unknown[] }[],
): CancelCounts {
  return sections.reduce(
    (sum, section) => ({
      confirmed: sum.confirmed + section.confirmed.filter((b) => b.status === 'confirmed').length,
      invited: sum.invited + section.invited.length,
      applied: sum.applied + section.applied.length,
    }),
    { confirmed: 0, invited: 0, applied: 0 },
  );
}

// ---------------------------------------------------------------------
// §3.2 — Duplicate: the clone copies the roles, NOT the staff
// ---------------------------------------------------------------------

export interface CloneSource {
  role_id: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  charge_rate: number | string;
  pay_rate: number | string;
  dress_code: string | null;
  auto_assign: boolean;
  allocation_per_hour: number;
}

export interface ClonedSection {
  role_id: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  charge_rate: number;
  pay_rate: number;
  dress_code: string | null;
  auto_assign: boolean;
  allocation_per_hour: number;
}

/**
 * Every role section, on the new date, at the same UK wall-clock times —
 * a 17:00–01:30 section stays 17:00–01:30 across a BST changeover, which
 * shifting the instants by whole days would not give. Headcount, buffer,
 * rates, dress code, allocation and the role's own Auto-assign switch come
 * across; no booking does (§3.2: "the clone copies the roles, NOT the
 * staff").
 */
export function cloneSections(sources: CloneSource[], toDate: string): ClonedSection[] {
  return sources.map((source) => {
    const start = formatTimeIn(new Date(source.starts_at), UK_ZONE);
    const end = formatTimeIn(new Date(source.ends_at), UK_ZONE);
    const { startsAt, endsAt } = ukRoleWindow(toDate, start, end);
    return {
      role_id: source.role_id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      headcount: source.headcount,
      buffer: source.buffer,
      charge_rate: Number(source.charge_rate),
      pay_rate: Number(source.pay_rate),
      dress_code: source.dress_code,
      auto_assign: source.auto_assign,
      allocation_per_hour: source.allocation_per_hour,
    };
  });
}

/** "Gala Dinner (copy)" — the clone's working title until the manager renames it. */
export function cloneTitle(title: string): string {
  return `${title} (copy)`;
}
