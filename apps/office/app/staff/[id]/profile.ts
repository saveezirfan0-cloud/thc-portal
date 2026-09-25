import { canTransitionStaff } from '@thc/domain';
import { formatUkDate } from '../staff';
import type { ViolationRow as MonitorViolationRow } from '../../checkin/types';
import type {
  DeclarationRow,
  DocumentRow,
  FeedbackRow,
  ProfileRow,
  ShiftRow,
  ViolationRow,
} from './types';

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
 *
 * The opening clause states the profile's real position. "Documents
 * verified, quiz passed" is true of a compliant worker; a blocked,
 * inactive, rejected or removed one has a different fact to lead with,
 * and a candidate is neither "Compliant and bookable" nor done. The tail
 * is never empty: the contract stamp, "Compliant and bookable." for a
 * compliant worker without one, else "Contract not yet signed."
 */
export function complianceSummary(profile: {
  status: string;
  contract_signed_at: string | null;
  left_at?: string | null;
  removed?: boolean;
}): string {
  const opening = complianceOpening(profile);
  if (profile.contract_signed_at) {
    return `${opening} Contract signed electronically: ${formatUkStamp(profile.contract_signed_at)}`;
  }
  if (profile.status === 'compliant') return `${opening} Compliant and bookable.`;
  return `${opening} Contract not yet signed.`;
}

function complianceOpening(profile: {
  status: string;
  left_at?: string | null;
  removed?: boolean;
}): string {
  if (profile.removed || profile.status === 'removed') return 'Removed under §1.7.';
  switch (profile.status) {
    case 'compliant':
      return 'Documents verified, quiz passed.';
    case 'blocked':
      return 'Blocked — see the banner above.';
    case 'inactive':
      return profile.left_at ? `Left ${formatUkDate(profile.left_at)}.` : 'Left through the app.';
    case 'rejected':
      return 'Rejected.';
    default:
      return 'Onboarding in progress.';
  }
}

/**
 * An audit stamp in UK time, labelled as such (§1.8). Never the viewer's
 * zone: a contract signature and a verification are records of when
 * something happened in the business's own time. Spelled `dd.mm.yyyy
 * hh:mm UK time`, the scope's and the wireframe's form ("12.07.2026 14:42
 * UK time") — Intl's en-GB would put slashes in it.
 */
export function formatUkStamp(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return `${formatUkDate(iso)} ${time} UK time`;
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
 * §9.6: "The Criminal Record declaration appears in this same list (Yes/No
 * + details, no file to download)". The list shows the CURRENT declaration
 * — the latest one §2.12 has not superseded — and the Overview tab keeps
 * the full history (§1.5). A reset supersedes every earlier answer, so a
 * profile mid-way through a second onboarding shows none until they
 * declare again.
 */
export function currentDeclaration(declarations: readonly DeclarationRow[]): DeclarationRow | null {
  const live = declarations.filter((row) => row.review_status !== 'superseded');
  if (live.length === 0) return null;
  return live.reduce((latest, row) => (row.declared_at > latest.declared_at ? row : latest));
}

/**
 * The declaration's row in the Documents list, as the wireframe spells it:
 * "Criminal Record declaration · No" with "Auto-verified 09.07.2026 · no
 * file to download", or the Yes with its details and its own status.
 */
export function declarationRow(row: DeclarationRow): { title: string; meta: string } {
  const title = `Criminal Record declaration · ${row.answer ? 'Yes' : 'No'}`;
  if (!row.answer) {
    return {
      title,
      meta: `Auto-verified ${formatUkDate(row.reviewed_at ?? row.declared_at)} · no admin action · no file to download`,
    };
  }
  const parts = [`Declared ${formatUkStamp(row.declared_at)}`];
  if (row.details) parts.push(`“${row.details}”`);
  if (row.conviction_date) parts.push(`Conviction date ${formatUkDate(row.conviction_date)}`);
  if (row.reviewed_at) parts.push(`Reviewed ${formatUkStamp(row.reviewed_at)}`);
  parts.push('no file to download');
  return { title, meta: parts.join(' · ') };
}

/**
 * What a pending document's Verify needs on this tab (§4.1 through the
 * same compliance_verify_document as /compliance):
 *
 *   - `completion_letter`: approve_completion_letter() confirms a
 *     completion date AND a visa expiry, with the cap consequences spelled
 *     out — that dialog lives on /compliance and the row links there.
 *   - `date`: a visa document, status document or share code report needs
 *     its right-to-work date (compliance/rtw.ts), so a date field opens.
 *   - `plain`: everything else verifies on the press.
 */
export function verifyRoute(docType: string): 'completion_letter' | 'date' | 'plain' {
  if (docType === 'university_completion_letter') return 'completion_letter';
  if (['visa_document', 'status_document', 'share_code_report'].includes(docType)) return 'date';
  return 'plain';
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
 * The row's button (staff-profile.html): "Details / Resolve" while the
 * entry is open, "Details" once it is resolved — the window is the same
 * one either way and shows the audit trail on a resolved entry.
 */
export function violationAction(row: Pick<ViolationRow, 'resolved'>): string {
  return row.resolved ? 'Details' : 'Details / Resolve';
}

/**
 * §9.6: the profile's log opens "the same detail window and the same
 * 'Resolve' action with its mandatory note as the log in §9.5". So the
 * profile hands the §9.5 window (checkin/ResolveModal) a row in ITS shape
 * rather than growing a second dialog: one component, one resolve path,
 * one mandatory note.
 *
 * The actual stamps come from the booking's shift-history row (the same
 * check_logs the monitor reads, settled by payable_shifts_v). Whether the
 * shift is already in a payroll export is not on either profile view; the
 * server says so after the fact (`resolveViolation` returns the warning),
 * so the window's up-front amber note is the one thing this surface lacks
 * until staff_shift_history_v carries payroll_exported_at.
 */
export function toMonitorViolation(
  row: ViolationRow,
  shift: Pick<ShiftRow, 'check_in_at' | 'check_out_at'> | undefined,
  staffName: string,
  photoUrl: string | null = null,
): MonitorViolationRow {
  return {
    id: row.id,
    bookingId: row.booking_id,
    staffName,
    photoUrl,
    eventTitle: row.event_title,
    venueName: row.venue_name,
    roleName: row.role_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    type: row.type,
    detectedAt: row.detected_at,
    minutesLate: row.minutes_late,
    resolved: row.resolved,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name,
    resolutionNote: row.resolution_note,
    actualFinishAt: row.actual_finish_at ?? null,
    checkInAt: shift?.check_in_at ?? null,
    checkOutAt: row.actual_finish_at ?? shift?.check_out_at ?? null,
    payrollExported: false,
  };
}

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
 * Block is an edge of the §2.12 machine — compliant → blocked and nothing
 * else — and the database refuses every other origin
 * (`illegal_staff_transition`). §9.6 says the same in words: "A manual
 * Block is not the route for someone who has simply left." So the button
 * asks the same table the database does, rather than offering a manager
 * a form whose submit can only fail.
 */
export function canBlock(status: ProfileRow['status']): boolean {
  // `additional_info` is a kanban column, not a state of the machine
  // (ADR-0013); the office row type still carries it, the domain table does
  // not, and a candidate in that column has no edge to blocked either way.
  return status !== 'additional_info' && canTransitionStaff(status, 'blocked');
}

/** Remove (§1.7) is an edge from every state but removed itself. */
export function canRemove(status: ProfileRow['status']): boolean {
  return status === 'additional_info' || canTransitionStaff(status, 'removed');
}
