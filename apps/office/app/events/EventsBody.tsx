import { Alert, Panel } from '@thc/ui';
import { monthGrid, periodRange, weekDays } from './calendar';
import { loadClientNames, loadEventsInRange } from './data';
import { currentTimeFormat } from '../_lib/timeFormat';
import { EventToolbar, hrefFor } from './_components/EventToolbar';
import { DayView, ListView, MonthView, WeekView } from './_components/EventViews';
import type { EventQuery } from './_lib/filters';
import { SavedViewsBar } from './_lib/SavedViewsBar';
import { listMySavedViews } from './_lib/saved-views-actions';
import { bucketByDay, filterEventRows, periodTotals, toEventRows } from './view-model';

/**
 * The events themselves, streamed in behind the topbar by `page.tsx`: the
 * period's events, the client filter and the manager's saved views.
 */
export async function EventsBody({ query, today }: { query: EventQuery; today: string }) {
  const { view, date } = query;

  const { from, to } = periodRange(view, date);
  const [reference, { events, problem }, savedViews, format] = await Promise.all([
    loadClientNames(),
    loadEventsInRange(from, to),
    // The manager's own saved views, read fresh on every open (ADR-0059).
    listMySavedViews(),
    currentTimeFormat(),
  ]);

  const filters = { clientId: query.clientId, status: query.status, q: query.q };
  // Cancelled events are dropped here, whatever the filters (ADR-0099).
  const rows = filterEventRows(toEventRows(events, new Date(), format), filters);

  const totals = periodTotals(rows);

  return (
    <div className="stack">
      {reference.unavailable ? <Alert tone="coral">{reference.unavailable}</Alert> : null}
      {/* A failed read is said out loud, never drawn as an empty period. */}
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <EventToolbar query={query} clients={reference.clients} />

      {/* Named filter sets, kept per manager in office_saved_views. */}
      <SavedViewsBar query={query} clients={reference.clients} initial={savedViews} />

      {!problem && view === 'list' ? (
        <Panel flush className="stack" actions={null}>
          <div className="panel-b tight">
            <ListView rows={rows} today={today} />
          </div>
          <div className="panel-h" style={{ borderBottom: 0, borderTop: '1px solid var(--line)' }}>
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
        <WeekView days={weekDays(date)} buckets={bucketByDay(rows, weekDays(date))} today={today} />
      ) : null}

      {!problem && view === 'day' ? <DayView rows={rows} /> : null}
    </div>
  );
}
