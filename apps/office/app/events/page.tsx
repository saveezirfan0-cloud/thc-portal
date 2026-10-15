import Link from 'next/link';
import { Alert, ColumnChooserFor, Panel } from '@thc/ui';
import { monthGrid, periodRange, todayInUk, weekDays } from './calendar';
import { loadClientNames, loadEventsInRange, loadShiftRecords } from './data';
import { OfficeShell } from '../_components/OfficeShell';
import { currentTimeFormat } from '../_lib/timeFormat';
import { AutoRefresh } from '../_components/AutoRefresh';
import { EventToolbar, hrefFor } from './_components/EventToolbar';
import {
  DayView,
  EVENT_LIST_COLUMNS,
  EVENT_LIST_KEY,
  ListView,
  MonthView,
  WeekView,
} from './_components/EventViews';
import { parseEventQuery } from './_lib/filters';
import { SavedViewsBar } from './_lib/SavedViewsBar';
import { listMySavedViews } from './_lib/saved-views-actions';
import {
  bucketByDay,
  filterEventRows,
  parseShiftRecords,
  periodCrumb,
  periodTotals,
  recordNews,
  recordsInPeriod,
  toEventRows,
} from './view-model';
import './shift-builder.css';
import './events.css';

// Events, their fill and "today" are all per-request. Never prerender.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scheduling · THC Back Office' };

/**
 * /events — List and Calendar, Scope §3.1.
 *
 * The view, the period and the filters all live in the URL (`_lib/filters.ts`),
 * so every state of this screen is a link and the browser's own back button does what a manager
 * expects. The period arrows step a day, a week or a month depending on the
 * view, and work in List too — past events are browsable there, not only in
 * the calendar.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = todayInUk();
  // One parser for the URL, shared with the toolbar and the saved views.
  const query = parseEventQuery(await searchParams, today);
  const { view, date } = query;

  const { from, to } = periodRange(view, date);
  const calendarDays = view === 'week' ? weekDays(date) : view === 'day' ? [date] : null;
  const [reference, { events, problem }, savedViews, format, recordData] = await Promise.all([
    loadClientNames(),
    loadEventsInRange(from, to),
    // The manager's own saved views, read fresh on every open (ADR-0059).
    listMySavedViews(),
    currentTimeFormat(),
    // ADR-0142: the busiest day and week ever, for the Week and Day views.
    calendarDays ? loadShiftRecords() : null,
  ]);

  const filters = { clientId: query.clientId, status: query.status, q: query.q };
  // Cancelled events are dropped here, whatever the filters (ADR-0099).
  const rows = filterEventRows(toEventRows(events, new Date(), format), filters);

  const totals = periodTotals(rows);

  // The records are all-time and unfiltered: a client filter narrows the
  // rows, not what the business booked that week.
  const records = parseShiftRecords(recordData);
  const held =
    calendarDays && (view === 'week' || view === 'day')
      ? recordsInPeriod(records, view, calendarDays)
      : [];
  const news = held.map(recordNews);
  const recordDay = held.find((record) => record.kind === 'day')?.date ?? null;

  return (
    <OfficeShell
      activeHref="/events"
      title="Scheduling"
      // The wireframe's "events · Thu 18 Sep 2026": the period being read.
      crumbs={
        <>
          events · <b>{periodCrumb(date)}</b>
        </>
      }
      actions={
        // §3.1: the same place in every view, not in a sub-toolbar.
        <Link className="btn primary sm" href="/events/new">
          + New event
        </Link>
      }
    >
      <div className="stack">
        {/* Fill moves as staff accept and the office books: re-read every 15 s. */}
        <AutoRefresh everyMs={15_000} />
        {reference.unavailable ? <Alert tone="coral">{reference.unavailable}</Alert> : null}
        {/* A failed read is said out loud, never drawn as an empty period. */}
        {problem ? <Alert tone="coral">{problem}</Alert> : null}

        <EventToolbar query={query} clients={reference.clients} />

        {/* Named filter sets, kept per manager in office_saved_views. */}
        <SavedViewsBar query={query} clients={reference.clients} initial={savedViews} />

        {!problem && view === 'list' ? (
          <Panel
            flush
            className="stack"
            // ADR-0139: the list's own columns; a preference, never in the URL.
            actions={
              <ColumnChooserFor list={EVENT_LIST_KEY} defs={EVENT_LIST_COLUMNS} label="Events" />
            }
          >
            <div className="panel-b tight">
              <ListView rows={rows} today={today} />
            </div>
            <div
              className="panel-h"
              style={{ borderBottom: 0, borderTop: '1px solid var(--line)' }}
            >
              <span className="muted sm">
                {totals.events} event{totals.events === 1 ? '' : 's'} in this period · {totals.open}{' '}
                open position{totals.open === 1 ? '' : 's'}
              </span>
            </div>
          </Panel>
        ) : null}

        {!problem && view === 'month' ? (
          <MonthView
            cells={monthGrid(date)}
            buckets={bucketByDay(
              rows,
              monthGrid(date).map((cell) => cell.iso),
            )}
            today={today}
            dayHref={(iso) => hrefFor({ ...query, view: 'day', date: iso })}
          />
        ) : null}

        {!problem && view === 'week' ? (
          <WeekView
            days={weekDays(date)}
            buckets={bucketByDay(rows, weekDays(date))}
            today={today}
            records={news}
            recordDay={recordDay}
          />
        ) : null}

        {!problem && view === 'day' ? <DayView rows={rows} records={news} /> : null}
      </div>
    </OfficeShell>
  );
}
