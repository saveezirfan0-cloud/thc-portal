import Link from 'next/link';
import type { ReactNode } from 'react';
import { type CalendarView, periodLabel, shiftPeriod, todayInUk } from '../calendar';
import { EventFilters } from './EventFilters';
import type { ClientOption } from '../data';

export interface ToolbarQuery {
  view: CalendarView;
  date: string;
  q: string;
  clientId: string;
  status: string;
}

export function hrefFor(query: Partial<ToolbarQuery> & { view: CalendarView; date: string }) {
  const params = new URLSearchParams({ view: query.view, date: query.date });
  if (query.q) params.set('q', query.q);
  if (query.clientId) params.set('client', query.clientId);
  if (query.status) params.set('status', query.status);
  return `/events?${params.toString()}`;
}

/**
 * The one toolbar — Scope §3.1.
 *
 * List and Calendar are a single toggle that works both ways, never two; the
 * back and forward arrows sit in both views so past events are browsable in
 * the list as well; "+ New event" is in the page header rather than here.
 * All of it is links, so every view is a URL a manager can bookmark or share.
 */
export function EventToolbar({
  query,
  clients,
  extra,
}: {
  query: ToolbarQuery;
  clients: ClientOption[];
  /** View-specific pills on the right: the month legend, the day counters. */
  extra?: ReactNode;
}) {
  const { view, date } = query;
  const today = todayInUk();
  const isCalendar = view !== 'list';
  const calendarView: CalendarView = isCalendar ? view : 'month';

  return (
    <div className="toolbar">
      <div className="seg">
        <Link
          className={view === 'list' ? 'on' : undefined}
          href={hrefFor({ ...query, view: 'list' })}
        >
          List
        </Link>
        <Link
          className={isCalendar ? 'on' : undefined}
          href={hrefFor({ ...query, view: calendarView })}
        >
          Calendar
        </Link>
      </div>

      {isCalendar ? (
        <div className="seg sm">
          {(['month', 'week', 'day'] as const).map((option) => (
            <Link
              key={option}
              className={view === option ? 'on' : undefined}
              href={hrefFor({ ...query, view: option })}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="datenav">
        <Link
          href={hrefFor({ ...query, date: shiftPeriod(view, date, -1) })}
          aria-label="Previous period"
        >
          ‹
        </Link>
        <span className="lbl">{periodLabel(view, date, today)}</span>
        <Link
          href={hrefFor({ ...query, date: shiftPeriod(view, date, 1) })}
          aria-label="Next period"
        >
          ›
        </Link>
      </div>

      <Link className="btn sm" href={hrefFor({ ...query, date: today })}>
        Today
      </Link>

      <div className="right">
        {extra}
        <EventFilters query={query} clients={clients} />
      </div>
    </div>
  );
}
