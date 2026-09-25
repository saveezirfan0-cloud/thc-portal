import { STAFF_STATUSES, canTransitionStaff, formatTimeIn } from '@thc/domain';
import type { StaffStatus as MachineStatus } from '@thc/domain';
import { hoursText, ukNumericDate } from '../staff';
import type {
  DeclarationRow,
  DocumentRow,
  FeedbackRow,
  ProfileRow,
  ShiftRow,
  ViolationRow,
} from './types';

/** The database's enum is wider than the §2.12 machine (ADR-0013); narrow before asking it. */
function isStaffStatus(status: string): status is MachineStatus {
  return (STAFF_STATUSES as readonly string[]).includes(status);
}

/**
 * The profile's presentation rules (§9.6). Pure, so the ones that are easy
 * to get wrong can be driven directly.
 */

/**
 * §9.6: "If Hours this week reaches the full weekly limit (e.g. 48/48),
 * the value is highlighted amber."
 *
 * A null cap is two different situations and neither is amber: the 48h
 * opt-out has no ceiling to reach, and a cap that cannot be calculated at
 * all belongs to a worker who cannot be booked. The directory's
 * `capReason` tells those two apart in words; here they are simply not
 * "at the limit".
 */
export function hoursTone(cap: number | null, booked: number | null): 'warn' | 'default' {
  if (cap === null) return 'default';
  return Number(booked ?? 0) >= cap ? 'warn' : 'default';
}

/**
 * The "Hours this week" tile (§9.6): "worked / calculated weekly limit".
 *
 * The value is the hours actually worked this Mon–Sun week, over the cap.
 * The booked figure goes underneath, because it is what the cap gates on:
 * a worker at 8 h worked with 20 h already booked cannot take another
 * shift, so the amber highlight follows the committed hours (`hoursTone`)
 * — never less alarming than the number the rota guard enforces.
 */
export function hoursThisWeek(profile: {
  weekly_worked_hours?: number | string | null;
  weekly_booked_hours: number | string | null;
  weekly_cap_hours: number | null;
}): { value: string; booked: string; tone: 'warn' | 'default' } {
  const worked = hoursText(profile.weekly_worked_hours ?? 0);
  const cap = profile.weekly_cap_hours === null ? '—' : String(profile.weekly_cap_hours);
  return {
    value: `${worked} / ${cap}`,
    booked: `${hoursText(profile.weekly_booked_hours ?? 0)} h booked`,
    tone: hoursTone(profile.weekly_cap_hours, Number(profile.weekly_booked_hours ?? 0)),
  };
}

/** §9.6: "If No-shows is greater than zero, the number is highlighted red." */
export function noShowTone(count: number): 'danger' | 'default' {
  return count > 0 ? 'danger' : 'default';
}

/**
 * The closing line of the Documents panel (§9.6).
 *
 * "The panel closes with a one-line compliance summary — 'Documents
 * verified, quiz passed. Contract signed electronically: 12.07.2026 14:42'
 * … Until the contract is signed that line ends 'Compliant and bookable.'
 * instead, never with an empty slot."
 *
 * The timestamp is an audit record, so it is UK time whoever is reading
 * (§1.8) — unlike a scheduled time, which carries the viewer's zone as a
 * second line.
 */
export function complianceSummary(profile: {
  status: string;
  contract_signed_at: string | null;
  removed?: boolean;
}): string {
  // Every clause states the person's real state, and no two clauses of one
  // line may disagree: "Compliant and bookable" belongs to a compliant
  // worker only, and "Contract not yet signed" to somebody still going
  // through onboarding — a leaver, a rejected applicant or a removed record
  // is not waiting for a contract.
  const signed = profile.contract_signed_at
    ? ` Contract signed electronically: ${formatUkStamp(profile.contract_signed_at)}`
    : '';

  if (profile.removed || profile.status === 'removed') {
    return `Removed — personal data anonymised; the history stays.${signed}`;
  }
  switch (profile.status) {
    case 'compliant':
      return `Documents verified, quiz passed.${signed || ' Compliant and bookable.'}`;
    case 'blocked':
      return `Blocked — not bookable until the block is lifted.${signed}`;
    case 'inactive':
      return `Left through the app — not bookable.${signed}`;
    case 'rejected':
      return `Application rejected — not bookable.${signed}`;
    default:
      return `Onboarding in progress — not bookable yet.${signed || ' Contract not yet signed.'}`;
  }
}

/**
 * The banner over a blocked profile (§9.6: "they see the reason first"),
 * in words that fit the kind of block. Each lifts differently (§4.3,
 * §10.7), and telling the manager the wrong way out is worse than saying
 * nothing:
 *
 *   auto_document      lifts by itself once the document is verified and
 *                      the full re-check passes;
 *   conviction_review  lifts when the declaration is verified (then the
 *                      same re-check); a rejected declaration turns it
 *                      into a manual block;
 *   manual             only a manager's Unblock lifts it.
 */
export function blockBanner(profile: {
  block_kind: 'auto_document' | 'manual' | 'conviction_review' | null;
  block_reason: string | null;
}): { title: string; detail: string } {
  switch (profile.block_kind) {
    case 'manual':
      return {
        title: profile.block_reason ? `Blocked — ${profile.block_reason}` : 'Blocked by a manager',
        detail:
          'Manual block. Only a manager’s Unblock lifts it, and only after the full compliance check. The worker never sees the reason.',
      };
    case 'conviction_review':
      return {
        title: `Blocked — ${profile.block_reason ?? 'Criminal conviction declared — under review'}`,
        detail:
          'System block while the conviction declaration is reviewed. Verify it on the Documents tab and the block lifts through the full compliance re-check; reject it and it becomes a manual block that only a manager can lift. The worker never sees the details on a shared screen.',
      };
    default:
      return {
        title: profile.block_reason
          ? `Blocked — ${profile.block_reason}`
          : 'Blocked automatically — a document is out of date',
        detail:
          'System block: temporary, not a penalty. It lifts by itself once the document is verified and the full compliance re-check passes.',
      };
  }
}

/**
 * A declaration's review state in words (§9.6). The enum is never printed:
 * nobody reads "superseded" as a decision.
 */
export function reviewLabel(status: 'pending' | 'verified' | 'rejected' | 'superseded'): string {
  switch (status) {
    case 'pending':
      return 'Under review';
    case 'verified':
      return 'Verified';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Superseded';
  }
}

/**
 * An audit stamp in UK time, labelled as such (§1.8). Never the viewer's
 * zone: a contract signature and a verification are records of when
 * something happened in the business's own time. Dotted date, as §9.6
 * writes it: "12.07.2026 14:42".
 */
export function formatUkStamp(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${ukNumericDate(at)} ${time} UK time`;
}

/**
 * When a violation was detected, in the VIEWER's zone — "Wed 17 Sep · 17:03".
 *
 * The monitor (§9.5) prints this stamp viewer-local, and §9.6 says the
 * profile's log is the same log; the two must show the same instant in
 * the same clock to the same reader. The zone is a parameter so the test
 * can pin it — the hook that reads the browser lives on the screen.
 */
export function formatLocalStamp(iso: string | null, zone: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    day.find((entry) => entry.type === type)?.value ?? '';
  // ICU prints "Sept" in newer builds; the wireframe says "Sep".
  const month = part('month').slice(0, 3);
  return `${part('weekday')} ${part('day')} ${month} · ${formatTimeIn(at, zone)}`;
}

/**
 * §2.12 allows compliant ⇄ blocked and nothing else into `blocked`. §9.6:
 * "A manual Block is not the route for someone who has simply left". The
 * database refuses the rest (`staff_transitions`), so this is the button's
 * enabled state, asked of the same machine — a manager should not fill in
 * a reason and then read "illegal_staff_transition: inactive -> blocked".
 */
export function canBlock(status: ProfileRow['status']): boolean {
  return isStaffStatus(status) && canTransitionStaff(status, 'blocked');
}

/** A scheduled window, in UK time — RULE-18's role section, never the event's. */
export function formatUkWindow(startIso: string, endIso: string): string {
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  return `${time(startIso)} – ${time(endIso)}`;
}

/**
 * An actual check-in or check-out stamp, in the VIEWER's zone (§1.8):
 * "actual check-in/out stamps show viewer-local only". A worker who
 * checked in at 17:03 in Lisbon did so at 17:03 where they were.
 */
export function formatLocalTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Documents in the order §9.6 reads them: actionable, live, then history. */
export function documentOrder(a: DocumentRow, b: DocumentRow): number {
  const rank = (row: DocumentRow) => (row.review_status === 'pending' ? 0 : row.superseded ? 2 : 1);
  const difference = rank(a) - rank(b);
  if (difference !== 0) return difference;
  return b.uploaded_at.localeCompare(a.uploaded_at);
}

/**
 * How §9.6 labels a shift row's outcome. `turned_away` is its own answer
 * rather than a kind of no-show: RULE-15 pays a worker who was turned
 * away at the door on time, and calling it a no-show on the profile
 * would read as the worker's fault.
 */
export function shiftOutcome(row: ShiftRow): string {
  if (row.booking_status === 'cancelled') {
    return row.self_cancelled ? 'Self-cancelled' : 'Cancelled';
  }
  if (row.kind === 'turned_away') return 'Turned away (buffer)';
  if (row.kind === 'no_show') return 'No-show';
  if (row.kind === 'worked') return 'Worked';
  if (row.booking_status === 'confirmed') return 'Confirmed';
  if (row.booking_status === 'invited') return 'Invited';
  if (row.booking_status === 'applied') return 'Applied';
  if (row.booking_status === 'worked') return 'Worked';
  if (row.booking_status === 'turned_away') return 'Turned away (buffer)';
  // `closed`: an invitation or application that did not go ahead (§3.6).
  if (row.booking_status === 'closed') return 'Did not go ahead';
  // Never the raw enum.
  return 'Other';
}

/**
 * The Shifts tab's "Last 90 days / All" (wireframe). Ninety days back from
 * today, by the shift's own start; anything still ahead is always shown,
 * because a booking next week is not history the filter should hide.
 */
export type ShiftRange = '90' | 'all';

export function shiftsInRange<T extends { starts_at: string }>(
  rows: readonly T[],
  range: ShiftRange,
  now: Date,
): T[] {
  if (range === 'all') return [...rows];
  const from = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  return rows.filter((row) => new Date(row.starts_at).getTime() >= from);
}

/** The payable figure RULE-01 settled, formatted. Never recalculated here. */
export function payableHours(row: ShiftRow): string {
  if (!row.pay || typeof row.pay.payableMin !== 'number') return '—';
  const hours = row.pay.payableMin / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
}

export const VIOLATION_LABEL: Record<ViolationRow['type'], string> = {
  no_show: 'No-show',
  late: 'Late',
  left_early: 'Left early',
  left_geofence: 'Left the geofence',
  no_checkout: 'No check-out',
};

/**
 * §9.10: a client entry counts toward the rating only once it has been
 * marked read, and "Mark as read" lives only on the Feedback screen. The
 * profile therefore shows the state and offers no control for it — a
 * second place to mark something read is a second place for the rating to
 * diverge from the scoring engine's.
 */
export function feedbackState(row: Pick<FeedbackRow, 'author_kind' | 'read_at'>): string {
  if (row.author_kind === 'office') return 'Office entry';
  return row.read_at ? 'Read' : 'Unread — not in the rating yet';
}

/**
 * §9.6: "Reset to candidate — available on a blocked, rejected or
 * inactive profile." The database asserts the same thing from the other
 * side, so this is the button's enabled state, not the rule.
 */
export function canReset(status: ProfileRow['status']): boolean {
  return status === 'blocked' || status === 'rejected' || status === 'inactive';
}

/**
 * §1.7 keeps a removed profile openable with its non-personal history
 * visible, and every action on it is spent: the worker is already
 * anonymised, holds no bookings and cannot log in.
 */
export function isActionable(status: ProfileRow['status']): boolean {
  return status !== 'removed';
}

/**
 * A Criminal Record declaration as a row of the Documents tab (§9.6): when,
 * where it came from, and what happened to it. The stamps are audit
 * records, so UK time (§1.8). A declaration never has a file.
 */
export function declarationMeta(row: DeclarationRow): string {
  const parts = [
    `${row.source === 'onboarding' ? 'Onboarding' : 'In employment'} · declared ${formatUkStamp(row.declared_at)}`,
  ];
  if (!row.answer) parts.push('auto-verified on submission — no admin action');
  else if (row.reviewed_at) parts.push(`reviewed ${formatUkStamp(row.reviewed_at)}`);
  parts.push('no file to download');
  return parts.join(' · ');
}

/**
 * Verify / Reject is offered only on a Yes still under review: a No is
 * auto-verified on submission and never queues (§2.10, §4.1), and a decided
 * or superseded declaration is history, never re-decided (§1.5).
 */
export function declarationActionable(row: DeclarationRow): boolean {
  return row.answer && row.review_status === 'pending';
}
