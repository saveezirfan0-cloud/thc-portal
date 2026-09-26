'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState, useTransition } from 'react';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { Alert, Avatar, Button, EmptyState, Panel, Pill } from '@thc/ui';
import { actionLabel, entityLabel } from '../../_lib/accounts';
import { actorName, describe } from '../../activity/view-model';
import { loadRecordHistory } from './actions';
import {
  HISTORY_SCOPE,
  type HistoryEntity,
  type HistoryRow,
  historyHref,
  mergeOlder,
} from './model';
import '../../activity/activity.css';
import './history.css';

/**
 * History — the audit trail of one record (ADR-0049 · §1.7), on the staff
 * profile (a tab), the client card (a block) and the event board (a
 * panel, closed until asked for — that screen is busy enough).
 *
 * Read on demand through a server action rather than with the page, so a
 * profile or a board that is opened for something else costs no extra
 * query. Newest first, 25 at a time, "Older" pages on the log's id.
 *
 * Every stamp is an audit stamp: UK time only (§1.8). The words are the
 * activity log's own, so an entry reads the same here and on /activity.
 */
export function RecordHistory({
  entity,
  id,
  title = 'History',
  deferred = false,
}: {
  entity: HistoryEntity;
  id: string;
  title?: ReactNode;
  /** Closed until "Show history" is pressed (the event board). */
  deferred?: boolean;
}) {
  const [open, setOpen] = useState(!deferred);
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [older, setOlder] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(
    (before: number | null) => {
      start(async () => {
        const page = await loadRecordHistory(entity, id, before);
        setProblem(page.problem);
        setRows((shown) => (before === null || !shown ? page.rows : mergeOlder(shown, page.rows)));
        setOlder(page.nextBefore);
      });
    },
    [entity, id],
  );

  useEffect(() => {
    if (open) load(null);
  }, [open, load]);

  return (
    <Panel
      className="record-history"
      title={title}
      flush
      actions={
        open ? (
          <>
            <span className="muted sm">{HISTORY_SCOPE[entity]}</span>
            <Button size="sm" tone="ghost" disabled={pending} onClick={() => load(null)}>
              Refresh
            </Button>
            {deferred ? (
              <Button size="sm" tone="ghost" onClick={() => setOpen(false)}>
                Hide
              </Button>
            ) : null}
          </>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            Show history
          </Button>
        )
      }
    >
      {!open ? null : (
        <>
          {problem ? (
            <div className="history-alert">
              <Alert tone="coral">{problem}</Alert>
            </div>
          ) : null}
          {rows === null ? (
            <EmptyState>{problem ? 'No history to show.' : 'Loading the history…'}</EmptyState>
          ) : rows.length === 0 ? (
            problem ? null : (
              <EmptyState>Nothing has been recorded about this yet.</EmptyState>
            )
          ) : (
            <div className="table-scroll">
              <table className="tbl card-rows activity-table">
                <thead>
                  <tr>
                    <th>When (UK time)</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Record</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const who = actorName(row);
                    const href = historyHref(row, { entity, id });
                    const details = describe(row);
                    return (
                      <tr key={row.id}>
                        <td data-label="When" className="mono sm activity-when">
                          {formatDateTimeIn(new Date(row.at), UK_ZONE)}
                        </td>
                        <td data-label="Who">
                          {row.actor ? (
                            <span className="history-who">
                              <Avatar name={who} size="sm" />
                              <span>{who}</span>
                            </span>
                          ) : (
                            <Pill>System</Pill>
                          )}
                        </td>
                        <td className="cell-title">
                          <b>{actionLabel(row.action)}</b>
                          <span className="sub">{entityLabel(row.entity)}</span>
                        </td>
                        <td data-label="Record">
                          {href && row.entity_label ? (
                            <Link href={href}>{row.entity_label}</Link>
                          ) : (
                            (row.entity_label ?? <span className="muted">—</span>)
                          )}
                        </td>
                        <td data-label="Details" className="sm muted activity-details">
                          {details.length ? details.join(' · ') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {older !== null ? (
            <div className="activity-pager">
              <Button size="sm" className="ml-auto" disabled={pending} onClick={() => load(older)}>
                {pending ? 'Loading…' : 'Older →'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
