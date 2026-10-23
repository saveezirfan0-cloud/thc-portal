import Link from 'next/link';
import { formatDateTimeIn, UK_ZONE } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { Alert, EmptyState, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import type { TicketsPageData } from './data';
import {
  KINDS,
  KIND_SHORT,
  KIND_TONE,
  PAGE_SIZE,
  SCOPE_LABELS,
  SCOPE_SHORT,
  SCOPE_TONE,
  SEVERITIES,
  SEVERITY_SHORT,
  SEVERITY_TONE,
  STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
  ticketsHref,
} from './view-model';
import type { TicketQuery } from './view-model';
import './tickets.css';

/**
 * /tickets — everything the team has reported from the Report button
 * (ADR-0202): newest first, Open / Closed / All, filtered by type, severity
 * and status, searchable by number ("TK-12"), words or reporter. The
 * filters are a plain GET form, so the address holds them and the page
 * needs no script. Stamps are audit stamps: UK time.
 */
export function TicketsScreen({
  data,
  query,
  format,
}: {
  data: TicketsPageData;
  query: TicketQuery;
  format?: TimeFormat;
}) {
  const stamp = (iso: string) => formatDateTimeIn(new Date(iso), UK_ZONE, format);
  const tabs = [
    { id: 'open', label: 'Open', count: data.open },
    { id: 'closed', label: 'Closed', count: data.closed },
    { id: 'all', label: 'All', count: data.open + data.closed },
  ] as const;
  const filtered = Boolean(
    query.q || query.kind || query.severity || query.status || (data.tracker && query.scope),
  );
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <OfficeShell
      activeHref="/tickets"
      title="Tickets"
      crumbs={
        <>
          issues, requests and updates from the team · <b>{data.open} open</b>
        </>
      }
    >
      {data.tracker ? (
        <p className="tk-meta">
          <Link href="/tickets/time">Monthly time report →</Link> (only you can see scope labels and
          time)
        </p>
      ) : null}
      <div className="tk-tabs" role="tablist" aria-label="Ticket state">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            role="tab"
            aria-selected={query.tab === tab.id}
            className={query.tab === tab.id ? 'btn primary' : 'btn'}
            href={ticketsHref({ ...query, tab: tab.id, page: 1 })}
          >
            {tab.label} <span className="tk-count">{tab.count}</span>
          </Link>
        ))}
      </div>

      <form className="tk-filters" method="get" action="/tickets">
        {query.tab !== 'open' ? <input type="hidden" name="tab" value={query.tab} /> : null}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={query.q}
          placeholder="Search by number, words or reporter"
          aria-label="Search tickets"
        />
        <select className="input" name="kind" defaultValue={query.kind ?? ''} aria-label="Type">
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_SHORT[k]}
            </option>
          ))}
        </select>
        <select
          className="input"
          name="severity"
          defaultValue={query.severity ?? ''}
          aria-label="Severity"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_SHORT[s]}
            </option>
          ))}
        </select>
        <select
          className="input"
          name="status"
          defaultValue={query.status ?? ''}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {data.tracker ? (
          <select
            className="input"
            name="scope"
            defaultValue={query.scope ?? ''}
            aria-label="Scope label"
          >
            <option value="">Any scope label</option>
            <option value="none">Not labelled yet</option>
            {SCOPE_LABELS.map((l) => (
              <option key={l} value={l}>
                {SCOPE_SHORT[l]}
              </option>
            ))}
          </select>
        ) : null}
        <button className="btn primary" type="submit">
          Apply
        </button>
        {filtered ? (
          <Link className="btn" href={ticketsHref({ tab: query.tab })}>
            Clear
          </Link>
        ) : null}
      </form>

      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      {!data.problem && data.tickets.length === 0 ? (
        <EmptyState>
          {filtered
            ? 'No tickets match those filters.'
            : query.tab === 'closed'
              ? 'Nothing has been closed yet.'
              : 'No open tickets. Use Report, top right, to log one.'}
        </EmptyState>
      ) : null}

      {data.tickets.length > 0 ? (
        <Panel flush>
          <ul className="tk-list">
            {data.tickets.map((t) => (
              <li key={t.id} className="tk-row">
                <Link href={`/tickets/${t.id}`} className="tk-link">
                  <span className="tk-ref">{ticketRef(t.ticket_no)}</span>
                  <Pill tone={KIND_TONE[t.kind]}>{KIND_SHORT[t.kind]}</Pill>
                  <span className="tk-main">
                    <span className="tk-title">{t.title}</span>
                    {t.details ? <span className="tk-snippet">{t.details}</span> : null}
                    <span className="tk-meta">
                      {t.reporter_name} · {stamp(t.created_at)}
                      {t.assignee_name ? <> · owner {t.assignee_name}</> : null}
                      {t.page_path ? <> · {t.page_path}</> : null}
                    </span>
                  </span>
                  <span className="tk-pills">
                    {t.severity ? (
                      <Pill tone={SEVERITY_TONE[t.severity]}>{SEVERITY_SHORT[t.severity]}</Pill>
                    ) : null}
                    <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
                    {data.scopes[t.id] ? (
                      <Pill tone={SCOPE_TONE[data.scopes[t.id]!]}>
                        {SCOPE_SHORT[data.scopes[t.id]!]}
                      </Pill>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {pages > 1 ? (
        <nav className="tk-pager" aria-label="Pages">
          {query.page > 1 ? (
            <Link className="btn" href={ticketsHref({ ...query, page: query.page - 1 })}>
              ← Newer
            </Link>
          ) : null}
          <span>
            Page {query.page} of {pages}
          </span>
          {query.page < pages ? (
            <Link className="btn" href={ticketsHref({ ...query, page: query.page + 1 })}>
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </OfficeShell>
  );
}
