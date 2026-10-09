'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Alert, Button, EmptyState, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { formatUkDate, statusLabel } from '../staff';
import type { StaffStatus } from '../types';
import { loadRoster, removeRosterEntries } from './actions';
import { REASON_TEXT } from './reasons';
import type { RosterReport } from './actions';
import type { AppliedEntry, RosterEntry } from './data';

const GROUP_LABEL = { spudbros: 'SpudBros Express', thc: 'THC' } as const;

/** How the application met the list (invite_list_applied_v.how). */
const HOW_LABEL: Record<AppliedEntry['how'], string> = {
  applied: 'Applied',
  name_mismatch: 'Applied — name differs from the list',
  already_here: 'Already in the system',
};

/**
 * /staff/roster — the invite list (ADR-0107).
 *
 * Paste the sheet (copied straight from a spreadsheet, or saved as CSV) with
 * a header row: Email, First name, Last name, Payroll ID, Group. Group says
 * which people are SpudBros Express and which are THC. When someone applies
 * with an email on the list they get that group and Payroll ID, whichever
 * link they used; anyone already in the system gets it applied now. What
 * remains below is "invited, not applied yet"; above it, "Applied" says who
 * has, and when, and where they are now.
 */
export function RosterScreen({
  waiting,
  applied,
  problem,
  canEdit,
}: {
  waiting: RosterEntry[];
  applied: AppliedEntry[];
  problem: string | null;
  canEdit: boolean;
}) {
  const [text, setText] = useState('');
  const [report, setReport] = useState<RosterReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () => {
    setFailure(null);
    setReport(null);
    start(async () => {
      const result = await loadRoster(text);
      if (result.ok) {
        setReport(result.report);
        setText('');
      } else setFailure(result.message);
    });
  };

  const remove = (ids: string[] | null) => {
    setFailure(null);
    start(async () => {
      const result = await removeRosterEntries(ids);
      if (!result.ok) setFailure(result.message);
    });
  };

  const spud = waiting.filter((row) => row.grp === 'spudbros').length;

  return (
    <OfficeShell
      activeHref="/staff"
      title="Invite list"
      crumbs={
        <>
          <Link href="/staff">Staff</Link> / <b>Invite list</b> · {applied.length} applied ·{' '}
          {waiting.length} waiting · {spud} SpudBros Express · {waiting.length - spud} THC
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <Panel title="Load the list">
        <p className="muted sm">
          One row per person, with a header row: <b>Email</b>, <b>First name</b>, <b>Last name</b>,{' '}
          <b>Payroll ID</b>, <b>Group</b> (SpudBros Express or THC). Paste it straight from the
          spreadsheet. When someone applies with an email on this list they are marked SpudBros
          Express or THC and given their Payroll ID — whichever link they used. People already in
          the system get it applied now.
        </p>
        <textarea
          className="input"
          style={{ width: '100%', minHeight: 160, fontFamily: 'monospace' }}
          aria-label="Invite list"
          placeholder={
            'Email\tFirst name\tLast name\tPayroll ID\tGroup\nsam@example.com\tSam\tSpud\t1641A\tSpudBros Express'
          }
          value={text}
          disabled={!canEdit || pending}
          onChange={(event) => setText(event.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <Button
            tone="primary"
            disabled={!canEdit || pending || text.trim() === ''}
            onClick={load}
          >
            {pending ? 'Loading…' : 'Load list'}
          </Button>
          {!canEdit ? <span className="muted sm"> Your login is read-only.</span> : null}
        </div>
        {failure ? <Alert tone="coral">{failure}</Alert> : null}
        {report ? <ReportView report={report} /> : null}
      </Panel>

      <Panel title={`Applied (${applied.length})`}>
        {applied.length === 0 ? (
          <EmptyState>
            <h3>Nobody on the list has applied yet</h3>
            <p>
              People appear here, newest first, as soon as they apply with an email on the list.
            </p>
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Applied</th>
                <th>Name</th>
                <th>Email</th>
                <th>Payroll ID</th>
                <th>Group</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {applied.map((row) => {
                const { label, tone } = statusLabel({
                  status: row.status as StaffStatus,
                  removed: row.removed,
                });
                return (
                  <tr key={row.staff_id}>
                    <td className="sm">
                      {formatUkDate(row.applied_at)}
                      {row.how !== 'applied' ? (
                        <div className="xs muted">{HOW_LABEL[row.how]}</div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                    </td>
                    <td>{row.email ?? '—'}</td>
                    <td className="mono">
                      {row.payroll_id ?? '—'}
                      {row.payroll_id_taken ? (
                        <div className="xs muted">ID already held by someone else</div>
                      ) : null}
                    </td>
                    <td>
                      <Pill tone={row.grp === 'spudbros' ? 'cyan' : undefined}>
                        {GROUP_LABEL[row.grp]}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={tone}>{label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Invited, not applied yet (${waiting.length})`}>
        {waiting.length === 0 ? (
          <EmptyState>
            <h3>Nobody is waiting</h3>
            <p>Everyone on the list has applied, or no list has been loaded.</p>
          </EmptyState>
        ) : (
          <>
            {canEdit ? (
              <div style={{ marginBottom: 8 }}>
                <Button size="sm" tone="outline" disabled={pending} onClick={() => remove(null)}>
                  Clear all {waiting.length}
                </Button>
              </div>
            ) : null}
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Payroll ID</th>
                  <th>Group</th>
                  <th>Loaded</th>
                  {canEdit ? <th aria-label="Remove" /> : null}
                </tr>
              </thead>
              <tbody>
                {waiting.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="mono">{row.payroll_id ?? '—'}</td>
                    <td>
                      <Pill tone={row.grp === 'spudbros' ? 'cyan' : undefined}>
                        {GROUP_LABEL[row.grp]}
                      </Pill>
                    </td>
                    <td className="sm muted">{formatUkDate(row.loaded_at)}</td>
                    {canEdit ? (
                      <td>
                        <Button
                          size="sm"
                          tone="ghost"
                          disabled={pending}
                          onClick={() => remove([row.id])}
                        >
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>
    </OfficeShell>
  );
}

function ReportView({ report }: { report: RosterReport }) {
  const rows = [
    ...report.held.map((row) => ({ ...row, kind: 'Held' })),
    ...report.skipped.map((row) => ({ ...row, kind: 'Not taken' })),
  ];
  return (
    <div style={{ marginTop: 8 }}>
      <Alert tone={rows.length > 0 ? 'amber' : 'green'}>
        <b>{report.loaded} added to the list</b> · {report.updated} already here and updated
        {rows.length > 0 ? ` · ${rows.length} need a look` : ''}
      </Alert>
      {rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Email</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.email ?? ''}-${i}`}>
                <td>{row.kind}</td>
                <td>{row.email ?? '—'}</td>
                <td>{REASON_TEXT[row.reason] ?? row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
