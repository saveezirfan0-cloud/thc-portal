'use client';

import Link from 'next/link';
import { Alert, EmptyState, Panel, Pill, TableScroll } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { NameCorrection } from '../../_components/NameCorrection';
import { NAME_REVIEW_REASONS } from '../../_lib/nameCorrection';
import type { NameToReview } from './data';

/** Candidates are read on /onboarding/:id, everyone else on /staff/:id. */
const CANDIDATE_STATUSES = new Set([
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
]);

export function profileHref(row: Pick<NameToReview, 'staff_id' | 'status'>): string {
  return CANDIDATE_STATUSES.has(row.status)
    ? `/onboarding/${row.staff_id}`
    : `/staff/${row.staff_id}`;
}

/**
 * /staff/names (ADR-0194): the office's list of names that are not yet the
 * passport's, newest first. "Correct" opens the same dialog as the profile;
 * the name on the Home Office record, where a share-code check found one, is
 * beside it as a guide — never filled in for you.
 */
export function NamesScreen({
  rows,
  problem,
  canCorrect,
}: {
  rows: NameToReview[];
  problem: string | null;
  canCorrect: boolean;
}) {
  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <>
          <Link href="/staff">Directory</Link> / <b>Names to review</b>
        </>
      }
    >
      <Panel title={`Names to review${problem ? '' : ` (${rows.length})`}`}>
        <p className="muted sm">
          Everyone below has a name that is an initial, has symbols, or is all in lower or upper
          case. Correct each to the name as the passport prints it. The name on the Home Office
          record is shown where a share-code check found one.
        </p>
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {!problem && rows.length === 0 ? (
          <EmptyState>
            <h3>Every name is in full</h3>
            <p>Nobody on file has an initial, symbols, or a name in all lower or upper case.</p>
          </EmptyState>
        ) : null}
        {rows.length > 0 ? (
          <TableScroll label="Names to review" minWidth="44rem">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name on file</th>
                  <th>Why</th>
                  <th>Home Office record</th>
                  <th>Profile</th>
                  <th aria-label="Correct" className="cell-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.staff_id}>
                    <td>
                      <b>
                        {row.first_name} {row.last_name}
                      </b>
                    </td>
                    <td>
                      {row.reasons.map((reason) => (
                        <Pill key={reason}>{NAME_REVIEW_REASONS[reason] ?? reason}</Pill>
                      ))}
                    </td>
                    <td>{row.record_name ?? <span className="muted">—</span>}</td>
                    <td>
                      <Link href={profileHref(row)}>
                        {CANDIDATE_STATUSES.has(row.status) ? 'Candidate' : 'Worker'}
                      </Link>
                    </td>
                    <td className="cell-actions">
                      <NameCorrection
                        staffId={row.staff_id}
                        first={row.first_name}
                        last={row.last_name}
                        allowed={canCorrect}
                        recordName={row.record_name}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}
      </Panel>
    </OfficeShell>
  );
}
