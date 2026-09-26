'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Panel, Pill, SegToggle, TableScroll } from '@thc/ui';
import { formatUkDate } from '../../staff/staff';
import { formatUkWindow } from '../../staff/[id]/profile';
import { gbpRound, marginTone, matchesEventFilter } from './card';
import type { ClientEventRow } from './types';
import type { EventFilter } from './card';

/**
 * Block 4 — every event for this client (§9.7).
 *
 * The date column is the DERIVED window, min start to max end across the
 * role sections (§3.2). Where sections run at different times the row
 * says so and sends the manager to the event page, because a single
 * window is the summary and the role times are the fact (RULE-18).
 *
 * The PO is read-only here, as §3.2 requires: it is entered once on the
 * event and appears on the timesheet and the invoice unchanged.
 */
const STATUS_TONE: Record<ClientEventRow['status'], 'cyan' | 'green' | 'neutral' | 'coral'> = {
  upcoming: 'cyan',
  ongoing: 'green',
  completed: 'neutral',
  cancelled: 'coral',
};

const PAGE_SIZE = 12;

export function ClientEvents({ rows }: { rows: ClientEventRow[] }) {
  const [filter, setFilter] = useState<EventFilter>('all');
  const [page, setPage] = useState(0);

  const shown = useMemo(
    () => rows.filter((row) => matchesEventFilter(row, filter)),
    [rows, filter],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <Panel
      title={
        <>
          <span className="blk-n">4</span> Events · this client
        </>
      }
      actions={
        <>
          <span className="muted sm">every event for this client · click opens the event page</span>
          <SegToggle
            small
            aria-label="Filter events"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(0);
            }}
            options={[
              { value: 'all', label: 'All', count: rows.length },
              {
                value: 'upcoming',
                label: 'Upcoming',
                count: rows.filter((row) => matchesEventFilter(row, 'upcoming')).length,
              },
              {
                value: 'completed',
                label: 'Completed',
                count: rows.filter((row) => row.status === 'completed').length,
              },
              {
                value: 'cancelled',
                label: 'Cancelled',
                count: rows.filter((row) => row.status === 'cancelled').length,
              },
            ]}
          />
        </>
      }
      flush
    >
      {slice.length === 0 ? (
        <div className="empty">
          <h3>No events</h3>
          <p>Nothing has been built for this client under that filter.</p>
        </div>
      ) : (
        <TableScroll>
          <table className="tbl card-rows">
            <thead>
              <tr>
                <th>Event</th>
                <th>PO</th>
                <th>Date · window (UK time)</th>
                <th>Venue</th>
                <th>Roles</th>
                <th className="right-align">Margin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((row) => (
                <tr key={row.id} className={row.cancelled_at ? 'muted' : undefined}>
                  <td className="cell-title">
                    <Link href={`/events/${row.id}`}>
                      <b>{row.title}</b>
                    </Link>
                  </td>
                  <td data-label="PO" className="mono sm">
                    {row.po_number ?? <span className="muted">—</span>}
                  </td>
                  <td data-label="Date · window (UK time)" className="mono sm">
                    {formatUkDate(row.event_date)} · {formatUkWindow(row.starts_at, row.ends_at)}
                    {row.section_count > 1 ? (
                      <span className="sub">derived window — role times are on the event page</span>
                    ) : null}
                  </td>
                  <td data-label="Venue" className="sm">
                    {row.venue_name}
                  </td>
                  <td data-label="Roles" className="sm">
                    {row.roles_summary ?? '—'}
                  </td>
                  <td
                    data-label="Margin"
                    className={`right-align mono ${marginTone(row.margin_pct)}`}
                  >
                    {gbpRound(row.margin_gbp)}
                    {row.margin_pct !== null ? (
                      <span className="sub muted">{row.margin_pct}%</span>
                    ) : (
                      <span className="sub muted">excluded</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <Pill tone={STATUS_TONE[row.status]}>{row.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {pages > 1 ? (
        <div className="panel-b row">
          <span className="muted sm">
            Showing {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + slice.length} of {shown.length}
          </span>
          <span className="right">
            <button
              type="button"
              className="btn sm ghost"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ‹ Prev
            </button>
            <span className="mono sm">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              className="btn sm ghost"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next ›
            </button>
          </span>
        </div>
      ) : null}
    </Panel>
  );
}
