'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Alert, Button, Panel, Pill, TableScroll, useTimeFormat } from '@thc/ui';
import { formatUkDate } from '../../staff/staff';
import { formatUkStamp } from '../../staff/[id]/profile';
import { markRequestHandled } from './actions';
import type { WorkerRequestRow } from './types';

/**
 * "Requests from the Client Portal" (ADR-0135 §2) — the customer's
 * "Request this person again" messages, on the client card.
 *
 * A request is a message, never a booking: nothing here invites or books
 * anyone. The office reads who was asked for, from which event and role,
 * the customer's note and who pressed it, then invites them from the event
 * board where they fit and presses **Mark handled** (audited as
 * `client.worker_request_handled` on this card's History). The office was
 * also emailed (CP1, /inbox). Open requests first, then the most recently
 * handled. Without the 'write' permission (a viewer, ADR-0060) there is no
 * button.
 */
export function WorkerRequests({
  clientId,
  rows,
  canWrite,
}: {
  clientId: string;
  rows: WorkerRequestRow[];
  canWrite: boolean;
}) {
  const format = useTimeFormat();
  const [handled, setHandled] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = rows.filter((r) => !r.handled_at && !handled.has(r.id)).length;

  const mark = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await markRequestHandled(clientId, id);
      if (result.ok) setHandled((prev) => new Set(prev).add(id));
      else setError(result.message);
    });
  };

  return (
    <Panel
      title="Requests from the Client Portal"
      actions={
        <>
          <span className="muted sm">“Request again” from a finished event · not a booking</span>
          <Pill tone={open > 0 ? 'cyan' : 'neutral'}>{open} open</Pill>
        </>
      }
      flush
    >
      {error ? <Alert tone="coral">{error}</Alert> : null}
      {rows.length === 0 ? (
        <div className="empty">
          <h3>No requests yet</h3>
          <p>When this client asks for someone again from the Client Portal, it appears here.</p>
        </div>
      ) : (
        <TableScroll>
          <table className="tbl card-rows">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Asked from</th>
                <th>Note from the client</th>
                <th>Requested (UK time)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const done = Boolean(row.handled_at) || handled.has(row.id);
                return (
                  <tr key={row.id} className={done ? 'muted' : undefined}>
                    <td className="cell-title">
                      {row.worker_removed ? (
                        <b className="muted">{row.worker_name}</b>
                      ) : (
                        <Link href={`/staff/${row.staff_id}`}>
                          <b>{row.worker_name}</b>
                        </Link>
                      )}
                      {row.employee_id !== null ? (
                        <span className="sub mono">ID {row.employee_id}</span>
                      ) : null}
                    </td>
                    <td data-label="Asked from" className="sm">
                      {row.event_id && row.event_title ? (
                        <Link href={`/events/${row.event_id}`}>{row.event_title}</Link>
                      ) : (
                        '—'
                      )}
                      <span className="sub">
                        {[row.role, row.event_date ? formatUkDate(row.event_date) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td data-label="Note from the client" className="sm">
                      {row.note ? <q>{row.note}</q> : <span className="muted">No note</span>}
                    </td>
                    <td data-label="Requested (UK time)" className="sm">
                      <span className="mono">{formatUkStamp(row.created_at, format)}</span>
                      {row.requested_by_name ? (
                        <span className="sub">by {row.requested_by_name}</span>
                      ) : null}
                    </td>
                    <td data-label="Status">
                      {done ? (
                        <Pill>
                          Handled
                          {row.handled_at ? ` ${formatUkDate(row.handled_at)}` : ''}
                        </Pill>
                      ) : canWrite ? (
                        <Button
                          size="sm"
                          onClick={() => mark(row.id)}
                          disabled={pending}
                          aria-label={`Mark the request for ${row.worker_name} handled`}
                        >
                          Mark handled
                        </Button>
                      ) : (
                        <Pill tone="cyan">Open</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
