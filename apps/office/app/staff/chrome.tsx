import Link from 'next/link';
import type { ReactNode } from 'react';
import { isWorker, matchesFilter } from './staff';
import type { StaffRow } from './types';

/**
 * The /staff topbar (§9.6, `wireframes/backoffice/staff.html`): the counts
 * line and the two links. Plain components with no hooks, so the page draws
 * them in its own `OfficeShell` around the streamed directory (ADR-0161) and
 * `StaffScreen` draws the same ones when it is rendered whole.
 */

export interface DirectoryCounts {
  all: number;
  compliant: number;
  blocked: number;
  inactive: number;
  removed: number;
}

/**
 * §9.6 counts workers. Candidates and rejected applicants come through the
 * same view but belong to /onboarding, so they are not counted (`isWorker`).
 */
export function directoryCounts(rows: readonly StaffRow[]): DirectoryCounts {
  const staff = rows.filter(isWorker);
  return {
    all: staff.length,
    compliant: staff.filter((row) => matchesFilter(row, 'compliant')).length,
    blocked: staff.filter((row) => matchesFilter(row, 'blocked')).length,
    inactive: staff.filter((row) => matchesFilter(row, 'inactive')).length,
    removed: staff.filter((row) => matchesFilter(row, 'removed')).length,
  };
}

export function StaffCrumbs({ counts }: { counts: DirectoryCounts }) {
  return (
    <>
      directory · <b>{counts.all.toLocaleString('en-GB')} workers</b> · {counts.compliant} compliant
      · {counts.blocked} blocked · {counts.inactive} inactive · {counts.removed} removed
    </>
  );
}

/**
 * ADR-0045: the office's queue for the name and photo §10.1 locks.
 * `count` null = the count could not be read: "(?)", never a claimed 0
 * (audit D18). Undefined = still being read: no number yet.
 */
export function ChangeRequestsLink({ count }: { count?: number | null }) {
  return (
    <Link
      href="/staff/requests"
      className="btn sm ghost"
      {...(count === null
        ? { title: 'The pending count could not be read — open the queue to see it.' }
        : {})}
    >
      Change requests{count === undefined ? '' : ` (${count ?? '?'})`}
    </Link>
  );
}

/**
 * In the top bar, not a band of their own above the status tabs that was
 * empty but for two links on the right (release audit L19).
 */
export function StaffActions({ requests }: { requests: ReactNode }) {
  return (
    <span className="row staff-requests-link">
      {requests}
      {/* ADR-0107: who is SpudBros Express, and each person's Payroll ID. */}
      <Link href="/staff/roster" className="btn sm ghost">
        Invite list
      </Link>
    </span>
  );
}
