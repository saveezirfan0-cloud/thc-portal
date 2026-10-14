import Link from 'next/link';
import { type TimeFormat, UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { OFFICE_INBOX } from '@thc/notifications';
import type { ReactNode } from 'react';
import {
  Alert,
  ColumnCellsFor,
  ColumnChooserFor,
  ColumnHeadsFor,
  EmptyState,
  Panel,
  Pill,
  TableScrollFor,
} from '@thc/ui';
import type { ColumnDef } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import type { InboxFilters, InboxPageData } from './data';
import { inboxHref } from './filters';
import { InboxFilterBar } from './InboxFilterBar';
import { present } from './view-model';
import './inbox.css';

const TYPES = OFFICE_INBOX.map(({ code, label }) => ({ code, label }));

/**
 * The inbox's columns, declared once (ADR-0139): What stays first. The
 * page is server-rendered, so it uses the list-keyed pieces.
 */
const LIST = 'inbox';
const COLUMNS = [
  { id: 'what', label: 'What', required: true },
  { id: 'about', label: 'About' },
  { id: 'to', label: 'To', width: 'xl' },
  { id: 'queued', label: 'Queued (UK time)', width: 'm' },
  { id: 'status', label: 'Status', width: 'l' },
] as const satisfies readonly ColumnDef[];
type ColumnId = (typeof COLUMNS)[number]['id'];

/**
 * /inbox — Inbox (ADR-0058, §8, §1.8).
 *
 * The emails the platform sent to the office and to payroll — E5–E10, the
 * completion-letter emails CL3–CL6 and the Monday payroll email — newest
 * first, fifty at a time. Read-only: a failed send is re-queued where it
 * was made (the event page, /reports), not here. Every stamp is an audit
 * stamp, so UK only.
 */
export function InboxScreen({
  data,
  filters,
  format,
}: {
  data: InboxPageData;
  filters: InboxFilters;
  /** The operator's clock (ADR-0085): a server component, so the page passes it down. */
  format?: TimeFormat;
}) {
  const ukStamp = (instant: Date) => formatDateTimeIn(instant, UK_ZONE, format);
  const entries = data.rows.map((row) => present(row, ukStamp));
  const filtered = Boolean(filters.type || filters.status || filters.before);

  return (
    <OfficeShell
      activeHref="/inbox"
      title="Inbox"
      crumbs={<>Emails the platform sent to the office and payroll</>}
    >
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
      {data.failedInPeriod > 0 && filters.status !== 'failed' ? (
        <Alert tone="coral">
          {data.failedInPeriod === 1
            ? '1 office email failed in this period. '
            : `${data.failedInPeriod} office emails failed in this period. `}
          <Link href={inboxHref(filters, { status: 'failed', type: null })}>Show failed</Link>
        </Alert>
      ) : null}

      <InboxFilterBar query={filters} types={TYPES} />

      <Panel flush actions={<ColumnChooserFor list={LIST} defs={COLUMNS} label="Office emails" />}>
        {entries.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'No office email matches these filters.'
              : 'No email was sent to the office in this period.'}
          </EmptyState>
        ) : (
          <TableScrollFor list={LIST} defs={COLUMNS} label="Office emails" fixed minWidth="56rem">
            <table className="tbl card-rows inbox-table">
              <thead>
                <tr>
                  <ColumnHeadsFor list={LIST} defs={COLUMNS} />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const cells: Record<ColumnId, ReactNode> = {
                    what: (
                      <td className="cell-title">
                        <b>{entry.type}</b>
                        {entry.subject ? <span className="sub">{entry.subject}</span> : null}
                      </td>
                    ),
                    about: (
                      <td data-label="About">
                        {entry.about.href ? (
                          <Link href={entry.about.href}>{entry.about.primary}</Link>
                        ) : (
                          entry.about.primary
                        )}
                        {entry.about.secondary ? (
                          <span className="sub sm muted">{entry.about.secondary}</span>
                        ) : null}
                      </td>
                    ),
                    to: (
                      <td data-label="To" className="sm muted inbox-to">
                        {entry.to}
                      </td>
                    ),
                    queued: (
                      <td data-label="Queued" className="mono sm inbox-when">
                        {entry.queuedAt}
                      </td>
                    ),
                    status: (
                      <td data-label="Status" className="inbox-status">
                        <Pill tone={entry.tone} dot>
                          {entry.statusLabel}
                        </Pill>
                        {entry.settledAt ? (
                          <span className="sub mono sm muted">{entry.settledAt}</span>
                        ) : null}
                        {entry.detail ? (
                          <span
                            className={`sub sm${entry.status === 'failed' ? ' inbox-error' : ''}`}
                          >
                            {entry.detail}
                          </span>
                        ) : null}
                      </td>
                    ),
                  };
                  return (
                    <tr key={entry.id}>
                      <ColumnCellsFor list={LIST} defs={COLUMNS} cells={cells} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScrollFor>
        )}
        <div className="inbox-pager">
          {filters.before ? (
            <Link className="btn sm" href={inboxHref(filters, { before: null })}>
              ← Newest
            </Link>
          ) : null}
          {data.nextBefore ? (
            <Link
              className="btn sm ml-auto"
              href={inboxHref(filters, { before: String(data.nextBefore) })}
            >
              Older →
            </Link>
          ) : null}
        </div>
      </Panel>
    </OfficeShell>
  );
}
