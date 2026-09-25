import Link from 'next/link';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { OFFICE_INBOX } from '@thc/notifications';
import { Alert, EmptyState, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import type { InboxFilters, InboxPageData } from './data';
import { inboxHref } from './filters';
import { InboxFilterBar } from './InboxFilterBar';
import { present } from './view-model';
import './inbox.css';

const TYPES = OFFICE_INBOX.map(({ code, label }) => ({ code, label }));

const ukStamp = (instant: Date) => formatDateTimeIn(instant, UK_ZONE);

/**
 * /inbox — Inbox (ADR-0038, §8, §1.8).
 *
 * The emails the platform sent to the office and to payroll — E5–E10, the
 * completion-letter emails CL3–CL6 and the Monday payroll email — newest
 * first, fifty at a time. Read-only: a failed send is re-queued where it
 * was made (the event page, /reports), not here. Every stamp is an audit
 * stamp, so UK only.
 */
export function InboxScreen({ data, filters }: { data: InboxPageData; filters: InboxFilters }) {
  const entries = data.rows.map((row) => present(row, ukStamp));
  const filtered = Boolean(filters.type || filters.status || filters.before);

  return (
    <OfficeShell
      activeHref="/inbox"
      title="Inbox"
      crumbs={<>Emails the platform sent to the office and payroll · §8</>}
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

      <Panel flush>
        {entries.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'No office email matches these filters.'
              : 'No email was sent to the office in this period.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="tbl card-rows inbox-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>About</th>
                  <th>To</th>
                  <th>Queued (UK time)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cell-title">
                      <b>{entry.type}</b>
                      {entry.subject ? <span className="sub">{entry.subject}</span> : null}
                    </td>
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
                    <td data-label="To" className="sm muted inbox-to">
                      {entry.to}
                    </td>
                    <td data-label="Queued" className="mono sm inbox-when">
                      {entry.queuedAt}
                    </td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
