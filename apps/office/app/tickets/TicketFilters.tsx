'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  KINDS,
  KIND_SHORT,
  SCOPE_LABELS,
  SCOPE_SHORT,
  SEVERITIES,
  SEVERITY_SHORT,
  STATUSES,
  STATUS_LABEL,
  ticketsHref,
} from './view-model';
import type { TicketQuery } from './view-model';

const SEARCH_DELAY_MS = 300;

type Filters = Pick<TicketQuery, 'q' | 'kind' | 'severity' | 'status' | 'scope'>;

const pick = (query: TicketQuery): Filters => ({
  q: query.q,
  kind: query.kind,
  severity: query.severity,
  status: query.status,
  scope: query.scope,
});

/**
 * The list's filters (ADR-0202), live: a choice applies the moment it is made
 * and the search a moment after the last key, so there is no Apply button.
 * The address holds them, as before; Enter in the search applies it at once.
 * `tracker` adds the scope-label filter, drawn only for the login that tracks.
 */
export function TicketFilters({
  query,
  tracker,
  filtered,
}: {
  query: TicketQuery;
  tracker: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filters, setFilters] = useState<Filters>(() => pick(query));
  // What this bar last put in the address: a different address is somebody
  // else's doing (Clear, a tab), and the controls follow it.
  const sent = useRef(JSON.stringify(pick(query)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const incoming = JSON.stringify(pick(query));
  useEffect(() => {
    if (incoming !== sent.current) {
      sent.current = incoming;
      setFilters(JSON.parse(incoming) as Filters);
    }
  }, [incoming]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const go = (next: Filters) => {
    if (timer.current) clearTimeout(timer.current);
    sent.current = JSON.stringify(next);
    start(() => router.replace(ticketsHref({ tab: query.tab, ...next, page: 1 })));
  };
  const choose = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    go(next);
  };
  const typing = (value: string) => {
    const next = { ...filters, q: value };
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next), SEARCH_DELAY_MS);
  };

  return (
    <form
      className="tk-filters"
      method="get"
      action="/tickets"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        go(filters);
      }}
    >
      {query.tab !== 'open' ? <input type="hidden" name="tab" value={query.tab} /> : null}
      <input
        className="input"
        type="search"
        name="q"
        value={filters.q}
        placeholder="Search by number, words or reporter"
        aria-label="Search tickets"
        onChange={(e) => typing(e.target.value)}
      />
      <select
        className="input"
        name="kind"
        value={filters.kind ?? ''}
        aria-label="Type"
        onChange={(e) => choose('kind', (e.target.value || null) as Filters['kind'])}
      >
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
        value={filters.severity ?? ''}
        aria-label="Severity"
        onChange={(e) => choose('severity', (e.target.value || null) as Filters['severity'])}
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
        value={filters.status ?? ''}
        aria-label="Status"
        onChange={(e) => choose('status', (e.target.value || null) as Filters['status'])}
      >
        <option value="">Any status</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {tracker ? (
        <select
          className="input"
          name="scope"
          value={filters.scope ?? ''}
          aria-label="Scope label"
          onChange={(e) => choose('scope', (e.target.value || null) as Filters['scope'])}
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
      {filtered ? (
        <a className="btn" href={ticketsHref({ tab: query.tab })}>
          Clear
        </a>
      ) : null}
    </form>
  );
}
