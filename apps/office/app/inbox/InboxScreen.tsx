import Link from 'next/link';
import { type TimeFormat, UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { WILLO_INVITE_NOTE, emailAudienceEntries } from '@thc/notifications';
import { Alert, EmptyState, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import type { InboxFilters, InboxPageData } from './data';
import { AUDIENCES, inboxHref } from './filters';
import { InboxFilterBar } from './InboxFilterBar';
import { present } from './view-model';
import './inbox.css';

const typesOf = (audience: InboxFilters['audience']) =>
  emailAudienceEntries(audience).map(({ code, label }) => ({ code, label }));

const SUBTITLE = {
  office: 'Emails the platform sent to the office and payroll',
  people: 'Emails the platform sent to candidates, workers and new logins',
  clients: 'Emails the platform sent to clients’ contacts',
} as const;

/**
 * /inbox — Inbox (ADR-0058, ADR-0086, §8, §1.8).
 *
 * The emails the platform sent, in three views: the office and payroll
 * (E5–E10, CL3–CL6, the Monday payroll email; the default), candidates and
 * workers (E2, E2b, E3, E4, E11, E12, OC1, OC2), and clients (D1, D2).
 * Newest first, fifty at a time, searchable by address or name. Read-only: a
 * failed send is re-queued where it was made (the event page, /reports, the
 * candidate's page), not here. It shows the subject and the recipient, never
 * the body or a set-up link. Every stamp is an audit stamp, so UK only.
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
  const filtered = Boolean(filters.type || filters.status || filters.before || filters.q);
  const people = filters.audience === 'people';
  const audienceLabel = AUDIENCES.find((a) => a.value === filters.audience)?.label ?? '';

  return (
    <OfficeShell activeHref="/inbox" title="Inbox" crumbs={<>{SUBTITLE[filters.audience]}</>}>
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
      {data.failedInPeriod > 0 && filters.status !== 'failed' ? (
        <Alert tone="coral">
          {data.failedInPeriod === 1
            ? `1 email failed in this period (${audienceLabel}). `
            : `${data.failedInPeriod} emails failed in this period (${audienceLabel}). `}
          <Link href={inboxHref(filters, { status: 'failed', type: null, q: null })}>
            Show failed
          </Link>
        </Alert>
      ) : null}

      <InboxFilterBar
        key={`${filters.audience}:${filters.q ?? ''}`}
        query={filters}
        types={typesOf(filters.audience)}
      />

      {people ? <p className="sm muted inbox-note">{WILLO_INVITE_NOTE}</p> : null}

      <Panel flush>
        {entries.length === 0 ? (
          <EmptyState>
            {filtered
              ? `No email matches these filters${filters.q ? ` or “${filters.q}”` : ''}. ${
                  filters.q
                    ? 'Nothing was sent to this address, or to anyone with this name, in this period. Try “All time”.'
                    : ''
                }`.trim()
              : `No ${audienceLabel.toLowerCase()} email was sent in this period.`}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="tbl card-rows inbox-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>{people ? 'Recipient' : 'About'}</th>
                  <th>To</th>
                  <th>Queued (UK time)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cell-title">
                      <b>
                        {entry.type} <span className="mono sm muted">{entry.code}</span>
                      </b>
                      {entry.subject ? <span className="sub">{entry.subject}</span> : null}
                    </td>
                    <td data-label={people ? 'Recipient' : 'About'}>
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
