import type { DocumentRow, FeedbackRow, ProfileRow, ShiftRow, ViolationRow } from './types';

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
  return (booked ?? 0) >= cap ? 'warn' : 'default';
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
}): string {
  const opening =
    profile.status === 'compliant' ? 'Documents verified, quiz passed.' : 'Onboarding in progress.';

  if (profile.contract_signed_at) {
    return `${opening} Contract signed electronically: ${formatUkStamp(profile.contract_signed_at)}`;
  }
  return `${opening} Compliant and bookable.`;
}

/**
 * An audit stamp in UK time, labelled as such (§1.8). Never the viewer's
 * zone: a contract signature and a verification are records of when
 * something happened in the business's own time.
 */
export function formatUkStamp(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${date} ${time} UK time`;
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
  return row.booking_status;
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
export function feedbackState(row: FeedbackRow): string {
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
