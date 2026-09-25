import Link from 'next/link';
import { type CalendarView, periodLabel, shiftPeriod, todayInUk } from '../calendar';
import { EventFilters } from './EventFilters';
import type { ClientOption } from '../data';
import { type EventQuery, eventsHref } from '../_lib/filters';

/** The screen's state — one definition, in `_lib/filters.ts`. */
export type ToolbarQuery = EventQuery;

/** The URL of a state of this screen. Kept under its old name for callers. */
export const hrefFor = eventsHref;

/**
 * The one toolbar — Scope §3.1.
 *
 * List and Calendar are a single toggle that works both ways, never two; the
 * back and forward arrows sit in both views so past events are browsable in
 * the list as well; "+ New event" is in the page header rather than here.
 * All of it is links, so every view is a URL a manager can bookmark or share.
 */
export function EventToolbar({ query, clients }: { query: ToolbarQuery; clients: ClientOption[] }) {
  const { view, date } = query;
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
        <span className="lbl">{periodLabel(view, date)}</span>
        <Link
          href={hrefFor({ ...query, date: shiftPeriod(view, date, 1) })}
          aria-label="Next period"
        >
          ›
        </Link>
      </div>

      <Link className="btn sm" href={hrefFor({ ...query, date: todayInUk() })}>
        Today
      </Link>

      <div className="right">
        {/* Keyed on the search so a saved view or the back button that
            changes it also resets the box, which holds its own draft. */}
        <EventFilters key={query.q} query={query} clients={clients} />
      </div>
    </div>
  );
}
