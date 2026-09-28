'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Avatar, Button, EmptyState, Panel, Pill, Tabs } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { RTW_LABEL, employeeId, formatUkDate } from '../staff';
import { DecideDialog } from './DecideDialog';
import type { DecideStage } from './DecideDialog';
import {
  changeSummary,
  decidedBy,
  decisionLabel,
  dobBefore,
  dobRequested,
  evidenceName,
  kindLabel,
  mayDecide,
  nameBefore,
  nameRequested,
  oldestFirst,
  requestedAt,
  ukStamp,
} from './model';
import { changeEvidenceLink } from './actions';
import type { ChangeRequestView } from './types';
import './requests.css';

type Tab = 'pending' | 'decided';

/**
 * /staff/requests — ADR-0045, `wireframes/backoffice/change-requests.html`
 * (Pending, Approve name, Reject, Decided, Empty).
 *
 * Pending oldest first — a worker who asked first is answered first — with
 * the profile now and what was asked for side by side, the evidence and
 * the worker's note. Approve and Reject open the one decide dialog the
 * /staff/:id banner also uses. A decided request is history: it is never
 * decided again, and the worker never sees who decided.
 */
export function RequestsScreen({
  pending,
  decided,
  problem,
  canDecideDob = false,
}: {
  pending: ChangeRequestView[];
  decided: ChangeRequestView[];
  problem: string | null;
  /** ADR-0070: `officeCan(role, 'identity')` — owners and managers decide a date of birth. */
  canDecideDob?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('pending');
  const [open, setOpen] = useState<{ id: string; stage: DecideStage } | null>(null);
  const [outcome, setOutcome] = useState<{ note: string; warning: string | null } | null>(null);
  const queue = oldestFirst(pending);
  const current = queue.find((row) => row.id === open?.id) ?? null;

  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <>
          <Link href="/staff">Directory</Link> / <b>Change requests</b>
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {/* ADR-0070: what an approved date of birth did to gov.uk and the opt-out. */}
        {outcome ? <Alert tone="green">{outcome.note}</Alert> : null}
        {outcome?.warning ? <Alert tone="amber">{outcome.warning}</Alert> : null}

        <Tabs
          value={tab}
          onChange={setTab}
          aria-label="Change requests"
          options={[
            { value: 'pending', label: 'Pending', count: queue.length, alert: queue.length > 0 },
            { value: 'decided', label: 'Decided' },
          ]}
        />

        {tab === 'pending' ? (
          queue.length === 0 ? (
            <EmptyState>
              <h3>No change requests waiting</h3>
              <p>
                Workers ask for a name, photo or date-of-birth change from Profile details in the
                app. New requests arrive here and by email to admin@ (RC1).
              </p>
            </EmptyState>
          ) : (
            <>
              {queue.map((row) => (
                <PendingCard
                  key={row.id}
                  row={row}
                  canDecideDob={canDecideDob}
                  onDecide={(stage) => setOpen({ id: row.id, stage })}
                />
              ))}
              <span className="muted xs">
                Oldest first · one pending request per worker per kind · the worker never sees who
                decided
              </span>
            </>
          )
        ) : (
          <DecidedTable rows={decided} />
        )}
      </div>

      <DecideDialog
        key={open ? `${open.id}:${open.stage}` : 'none'}
        request={current}
        stage={open?.stage ?? 'approve'}
        onStage={(stage) => setOpen((was) => (was ? { ...was, stage } : was))}
        onClose={() => setOpen(null)}
        canDecideDob={canDecideDob}
        onDone={setOutcome}
      />
    </OfficeShell>
  );
}

export function PendingCard({
  row,
  onDecide,
  canDecideDob = false,
}: {
  row: ChangeRequestView;
  onDecide: (stage: DecideStage) => void;
  canDecideDob?: boolean;
}) {
  const first = row.display_name.split(' ')[0] ?? row.display_name;
  const [problem, setProblem] = useState<string | null>(null);
  const evidence = evidenceName(row.evidence_path);

  const openEvidence = async () => {
    setProblem(null);
    const result = await changeEvidenceLink(row.id);
    if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
    else if (!result.ok) setProblem(result.message);
  };

  return (
    <article className="cr-card">
      <div className="rh">
        <Avatar size="sm" name={row.display_name} src={row.current_photo_url ?? undefined} />
        <span className="who">
          <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
        </span>
        <span className="mono sm muted">{employeeId(row.employee_id)}</span>
        <Pill>{kindLabel(row.kind)}</Pill>
        <span className="ml-auto mono sm muted">Requested {requestedAt(row.created_at)}</span>
      </div>
      <div className="rb">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {row.kind === 'name' || row.kind === 'dob' ? (
          <div className="cr-sides">
            <div className="side">
              <span className="label">Now</span>
              <span className="v">
                {(row.kind === 'dob' ? dobBefore(row) : nameBefore(row)) ?? '—'}
              </span>
            </div>
            <div className="arrow" aria-hidden>
              →
            </div>
            <div className="side">
              <span className="label">Requested</span>
              <span className="v">
                {(row.kind === 'dob' ? dobRequested(row) : nameRequested(row)) ?? '—'}
              </span>
            </div>
            <div className="side">
              <span className="label">Evidence · note</span>
              {evidence ? (
                <button type="button" className="cr-link sm" onClick={openEvidence}>
                  {evidence} ↗
                </button>
              ) : (
                <span className="muted sm">no evidence file</span>
              )}
              {row.worker_note ? <div className="sm">&ldquo;{row.worker_note}&rdquo;</div> : null}
            </div>
          </div>
        ) : (
          <div className="cr-sides">
            <div className="side">
              <span className="label">Now</span>
              <Avatar size="xl" name={row.display_name} src={row.current_photo_url ?? undefined} />
            </div>
            <div className="arrow" aria-hidden>
              →
            </div>
            <div className="side">
              <span className="label">Requested</span>
              <Avatar size="xl" name={row.display_name} src={row.proposed_photo_url ?? undefined} />
              <span className="xs muted">signed URL · expires in 10 min</span>
            </div>
            <div className="side">
              <span className="label">Note from {first}</span>
              {row.worker_note ? (
                <div className="sm">&ldquo;{row.worker_note}&rdquo;</div>
              ) : (
                <span className="muted sm">—</span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="rf">
        <span className="xs muted">
          {row.kind === 'name'
            ? `Right to work: ${row.rtw_branch ? (RTW_LABEL[row.rtw_branch] ?? row.rtw_branch) : '—'}${
                row.right_to_work_until ? ` · until ${formatUkDate(row.right_to_work_until)}` : ''
              }`
            : row.kind === 'dob'
              ? 'gov.uk matches the share code against it — a pending share code is checked again on approval'
              : 'Printed on timesheets from the next document; issued PDFs keep the old photo'}
        </span>
        {mayDecide(row.kind, canDecideDob) ? (
          <>
            <Button size="sm" tone="danger" onClick={() => onDecide('reject')}>
              Reject
            </Button>
            <Button size="sm" tone="primary" onClick={() => onDecide('approve')}>
              Approve
            </Button>
          </>
        ) : (
          <span className="xs muted">Owners and managers decide a date of birth</span>
        )}
      </div>
    </article>
  );
}

export function DecidedTable({ rows }: { rows: ChangeRequestView[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        <h3>Nothing decided yet</h3>
        <p>Approved, rejected and withdrawn requests are kept here as the record.</p>
      </EmptyState>
    );
  }
  return (
    <Panel flush>
      <div className="panel-b tight">
        <table className="tbl card-rows">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Kind</th>
              <th>Change</th>
              <th>Requested (UK)</th>
              <th>Decision</th>
              <th>By</th>
              <th>Decided (UK)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const decision = decisionLabel(row.status);
              return (
                <tr key={row.id}>
                  <td className="cell-title">
                    <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>{' '}
                    <span className="mono xs muted">{employeeId(row.employee_id)}</span>
                  </td>
                  <td data-label="Kind">{kindLabel(row.kind)}</td>
                  <td data-label="Change" className={row.removed ? 'muted' : undefined}>
                    {changeSummary(row)}
                  </td>
                  <td data-label="Requested (UK)" className="mono sm">
                    {ukStamp(row.created_at).replace(' UK time', '')}
                  </td>
                  <td data-label="Decision">
                    <Pill tone={decision.tone}>{decision.label}</Pill>
                    {row.status === 'rejected' && row.decision_reason ? (
                      <span className="sub xs muted">&ldquo;{row.decision_reason}&rdquo;</span>
                    ) : null}
                  </td>
                  <td data-label="By" className={row.decided_by_name ? undefined : 'muted'}>
                    {decidedBy(row)}
                  </td>
                  <td data-label="Decided (UK)" className="mono sm">
                    {ukStamp(row.decided_at).replace(' UK time', '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
