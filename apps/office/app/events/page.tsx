import Link from 'next/link';
import { Alert, Panel } from '@thc/ui';
import {
  type CalendarView,
  isCalendarView,
  monthGrid,
  periodRange,
  todayInUk,
  weekDays,
} from './calendar';
import { loadEventsInRange, loadReferenceData } from './data';
import { OfficeShell } from '../_components/OfficeShell';
import { EventToolbar, type ToolbarQuery } from './_components/EventToolbar';
import { DayView, ListView, MonthView, WeekView } from './_components/EventViews';
import { bucketByDay, filterEventRows, periodTotals, toEventRows } from './view-model';
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
  const today = todayInUk();
  const date = ISO_DATE.test(single('date')) ? single('date') : today;

  const query: ToolbarQuery = {
    view,
    date,
    q: single('q'),
    clientId: single('client'),
    status: single('status'),
  };

  const { from, to } = periodRange(view, date);
  const [reference, { events, problem }] = await Promise.all([
    loadReferenceData(),
    loadEventsInRange(from, to),
  ]);

  const rows = filterEventRows(toEventRows(events), {
    clientId: query.clientId,
    status: query.status,
    q: query.q,
  });

  const totals = periodTotals(rows);

  return (
    <OfficeShell
      activeHref="/events"
      title="Scheduling"
      crumbs={null}
      actions={
        // §3.1: the same place in every view, not in a sub-toolbar.
        <Link className="btn primary sm" href="/events/new">
          + New event
        </Link>
      }
    >
      <div className="stack">
        {reference.unavailable ? <Alert tone="coral">{reference.unavailable}</Alert> : null}
        {/* A failed read is said out loud, never drawn as an empty period. */}
        {problem ? <Alert tone="coral">{problem}</Alert> : null}

        <EventToolbar query={query} clients={reference.clients} />

        {!problem && view === 'list' ? (
          <Panel flush className="stack" actions={null}>
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
          />
        ) : null}

        {!problem && view === 'week' ? (
          <WeekView
            days={weekDays(date)}
            buckets={bucketByDay(rows, weekDays(date))}
            today={today}
          />
        ) : null}

        {!problem && view === 'day' ? <DayView rows={rows} /> : null}
      </div>
    </OfficeShell>
  );
}
