import Link from 'next/link';
import { Alert, Panel } from '@thc/ui';
import { UK_ZONE, formatTimeIn } from '@thc/domain';
import {
  type CalendarView,
  formatDayLong,
  isCalendarView,
  monthGrid,
  monthName,
  periodRange,
  todayInUk,
  weekDays,
} from './calendar';
import { loadEventsInRange, loadReferenceData } from './data';
import { OfficeShell } from '../_components/OfficeShell';
import { ViewerZone } from './_components/ViewerZone';
import { EventToolbar, type ToolbarQuery } from './_components/EventToolbar';
import {
  DayPills,
  DayView,
  ListView,
  MonthLegend,
  MonthView,
  WeekView,
} from './_components/EventViews';
import { bucketByDay, periodTotals, toEventRows } from './view-model';
import './shift-builder.css';
import './events.css';

// Events, their fill and "today" are all per-request. Never prerender.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scheduling · THC Back Office' };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /events — List and Calendar, Scope §3.1.
 *
 * The view, the period and the filters all live in the URL, so every state of
 * this screen is a link and the browser's own back button does what a manager
 * expects. The period arrows step a day, a week or a month depending on the
 * view, and work in List too — past events are browsable there, not only in
 * the calendar.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const view: CalendarView = isCalendarView(single('view'))
    ? (single('view') as CalendarView)
    : 'list';
  const now = new Date();
  const today = todayInUk(now);
  const date = ISO_DATE.test(single('date')) ? single('date') : today;

  const query: ToolbarQuery = {
    view,
    date,
    q: single('q'),
    clientId: single('client'),
    status: single('status'),
  };

  const { from, to } = periodRange(view, date);
  const [reference, events] = await Promise.all([loadReferenceData(), loadEventsInRange(from, to)]);

  const needle = query.q.trim().toLowerCase();
  const clientName = reference.clients.find((c) => c.id === query.clientId)?.name ?? '';

  let rows = toEventRows(events);
  if (clientName) rows = rows.filter((row) => row.clientName === clientName);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (needle) {
    rows = rows.filter((row) =>
      [row.title, row.clientName, row.venueName, row.poNumber]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }

  const totals = periodTotals(rows);

  return (
    <OfficeShell
      activeHref="/events"
      title="Scheduling"
      // events.html:81 — "events · Thu 18 Sep 2026 · 14:32 UK time".
      crumbs={
        <>
          events · <b>{formatDayLong(today)}</b> · {formatTimeIn(now, UK_ZONE)} UK time
        </>
      }
      // Every window on this screen is a scheduled time, so the topbar names
      // the reader's own zone and each window carries both (§1.8).
      timezone={<ViewerZone />}
      actions={
        // §3.1: the same place in every view, not in a sub-toolbar.
        <Link className="btn primary sm" href="/events/new">
          + New event
        </Link>
      }
    >
      <div className="stack">
        {reference.unavailable ? <Alert tone="coral">{reference.unavailable}</Alert> : null}

        <EventToolbar
          query={query}
          clients={reference.clients}
          extra={
            view === 'month' ? <MonthLegend /> : view === 'day' ? <DayPills rows={rows} /> : null
          }
        />

        {view === 'list' ? (
          <Panel flush className="stack" actions={null}>
            <div className="panel-b tight">
              <ListView rows={rows} today={today} />
            </div>
            <div
              className="panel-h"
              style={{ borderBottom: 0, borderTop: '1px solid var(--line)' }}
            >
              <span className="muted sm">
                {totals.events} event{totals.events === 1 ? '' : 's'} in {monthName(date)} ·{' '}
                {totals.open} open position{totals.open === 1 ? '' : 's'}
              </span>
            </div>
          </Panel>
        ) : null}

        {view === 'month' ? (
          <MonthView
            cells={monthGrid(date)}
            buckets={bucketByDay(
              rows,
              monthGrid(date).map((cell) => cell.iso),
            )}
            today={today}
          />
        ) : null}

        {view === 'week' ? (
          <WeekView
            days={weekDays(date)}
            buckets={bucketByDay(rows, weekDays(date))}
            today={today}
          />
        ) : null}

        {view === 'day' ? <DayView rows={rows} now={now} /> : null}
      </div>
    </OfficeShell>
  );
}
