import Link from 'next/link';
import { Panel, Pill } from '@thc/ui';
import {
  EVENT_STATUS_LABEL,
  type EventStatus,
  formatAllocation,
  formatCounter,
  formatEventFill,
  formatOpen,
} from '@thc/domain';
import { formatDayLong, formatDayShort, weekdayIndex } from '../calendar';
import {
  type DayBucket,
  type EventRow,
  WEEK_COLUMN_FOLD_AT,
  bandDay,
  fillTone,
  monthCellModel,
} from '../view-model';
import { ChipStatus } from './ChipStatus';
import { MonthCellEvents } from './MonthCellEvents';
import { ScheduledWindow } from './ScheduledWindow';

const STATUS_TONE: Record<EventStatus, 'cyan' | 'green' | 'neutral'> = {
  upcoming: 'cyan',
  ongoing: 'green',
  completed: 'neutral',
  cancelled: 'neutral',
};

export function StatusPill({ status }: { status: EventStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} dot={status === 'ongoing'}>
      {EVENT_STATUS_LABEL[status]}
    </Pill>
  );
}

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------
// List
// ---------------------------------------------------------------------

export function ListView({ rows, today }: { rows: EventRow[]; today: string }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <div className="empty">No events in this period.</div>
      </Panel>
    );
  }

  // `card-rows`: below 760px each event is a card, titled by the event, with
  // every other column printed against its `data-label`.
  return (
    <table className="tbl card-rows">
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Client · Venue</th>
          {/* Scheduled times, so the column says which zone it is in (§1.8). */}
          <th>Window (UK time)</th>
          <th>Roles · headcount (+buffer)</th>
          <th>Fill</th>
          <th>Status</th>
          <th>PO</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const cancelled = row.status === 'cancelled';
          const open = formatOpen(row.fill);
          return (
            <tr key={row.id} className={cancelled ? undefined : 'clickable'}>
              <td data-label="Date">
                <b className={row.date === today ? 'cyan' : undefined}>
                  {formatDayShort(row.date)}
                </b>
                {row.date === today ? <span className="sub">today</span> : null}
              </td>
              <td className={classes('cell-title', cancelled && 'muted')}>
                {cancelled ? (
                  <s>{row.title}</s>
                ) : (
                  <Link href={`/events/${row.id}`}>
                    <b>{row.title}</b>
                  </Link>
                )}
                {cancelled && row.cancelReason ? (
                  <span className="sub">{row.cancelReason}</span>
                ) : null}
              </td>
              <td data-label="Client · Venue" className={cancelled ? 'muted' : undefined}>
                {row.clientName}
                <span className="sub">{row.venueName}</span>
              </td>
              <td
                data-label="Window (UK time)"
                className={classes('mono', 'sm', cancelled && 'muted')}
              >
                {/* UK, plus "your time" for a reader outside the UK (§1.8). */}
                {row.windowIso ? (
                  <ScheduledWindow
                    startsAt={row.windowIso.startsAt}
                    endsAt={row.windowIso.endsAt}
                  />
                ) : (
                  row.windowLabel
                )}
                {row.endsNextDay ? <span className="sub">ends next day</span> : null}
              </td>
              <td data-label="Roles · headcount (+buffer)" className="cell-wide">
                <div className="roles">
                  {row.roles.map((role, index) => (
                    <div className="r" key={`${row.id}-${index}`}>
                      <span className="chip">{role.roleName}</span>
                      <ScheduledWindow
                        className="mono win"
                        startsAt={role.startsAt}
                        endsAt={role.endsAt}
                      />
                      <span className="mono alloc">
                        {formatAllocation(role.headcount, role.buffer)}
                      </span>
                    </div>
                  ))}
                  {row.roles.length === 0 ? <span className="muted sm">No roles yet</span> : null}
                </div>
              </td>
              <td data-label="Fill">
                {cancelled ? (
                  // §3.3: only a cancellation BEFORE the day is excluded; on
                  // the day the scheduled hours are billed and paid in full.
                  <span className="muted sm">
                    {row.cancelledNote ?? 'excluded from financials'}
                  </span>
                ) : (
                  <>
                    <Pill tone={fillTone(row) === 'green' ? 'green' : 'amber'}>
                      {formatEventFill(row.fill)}
                    </Pill>
                    {open ? <span className="sub">{open}</span> : null}
                    {row.fill.bufferConfirmed > 0 ? (
                      <span className="sub">+{row.fill.bufferConfirmed} buffer confirmed</span>
                    ) : null}
                  </>
                )}
              </td>
              <td data-label="Status">
                <StatusPill status={row.status} />
              </td>
              <td data-label="PO" className={classes('mono', 'sm', !row.poNumber && 'muted')}>
                {row.poNumber || '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------

const WEEKDAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView({
  cells,
  buckets,
  today,
  dayHref,
}: {
  cells: { iso: string; dayOfMonth: number; inMonth: boolean }[];
  buckets: Map<string, DayBucket>;
  today: string;
  /**
   * The Day view of a date. On a phone the grid is too narrow for chips, so
   * each event is a dot and the whole cell opens its day (events.css).
   */
  dayHref?: (iso: string) => string;
}) {
  return (
    <div className="cal">
      {WEEKDAY_HEADS.map((day) => (
        <div className="dh" key={day}>
          {day}
        </div>
      ))}
      {cells.map((cell) => {
        const bucket = buckets.get(cell.iso);
        return (
          <div
            key={cell.iso}
            className={classes('day', !cell.inMonth && 'other', cell.iso === today && 'today')}
          >
            <div className="d">
              {dayHref ? (
                <Link
                  className="dlink"
                  href={dayHref(cell.iso)}
                  aria-label={`Open ${formatDayLong(cell.iso)}`}
                >
                  {cell.dayOfMonth}
                </Link>
              ) : (
                cell.dayOfMonth
              )}
              {bucket && bucket.count > 0 ? (
                <span className="cnt">
                  {bucket.allCancelled
                    ? `${bucket.count} ev · cancelled`
                    : formatCounter(bucket.count, bucket.open)}
                </span>
              ) : null}
            </div>
            {bucket && bucket.events.length > 0 ? (
              <MonthCellEvents
                model={monthCellModel(bucket.events)}
                heading={`${formatDayLong(cell.iso)} · ${
                  bucket.allCancelled
                    ? `${bucket.count} ev · cancelled`
                    : formatCounter(bucket.count, bucket.open)
                }`}
                dayHref={dayHref ? dayHref(cell.iso) : null}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Week — seven columns of vertical lists, ordered by window start (§3.1)
// ---------------------------------------------------------------------

export function WeekView({
  days,
  buckets,
  today,
}: {
  days: string[];
  buckets: Map<string, DayBucket>;
  today: string;
}) {
  return (
    <div className="wk">
      {days.map((iso) => {
        const bucket = buckets.get(iso);
        const count = bucket?.count ?? 0;
        const open = bucket?.open ?? 0;
        return (
          <div className={classes('col', iso === today && 'today')} key={iso}>
            <div className="ch">
              <span className="d">
                {WEEKDAY_HEADS[weekdayIndex(iso)]} {Number(iso.slice(8, 10))}
                {iso === today ? ' · today' : ''}
              </span>
              <span className={classes('c', open === 0 && !bucket?.allCancelled && 'ok')}>
                {count === 0
                  ? '0 ev'
                  : bucket?.allCancelled
                    ? `${count} ev · cancelled`
                    : formatCounter(count, open)}
              </span>
            </div>
            <WeekColumnBands rows={bucket?.events ?? []} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A column's events, folded into day bands (Overnight, Morning, Afternoon, Evening, and
 * "No roles yet" for an event with no role sections) that open
 * and close on their own (ADR-0096). A column of 8 or fewer shows everything;
 * a longer one opens only the bands that still need staff, so the page — not
 * seven inner scroll boxes — is what scrolls, and what is short is on top.
 */
function WeekColumnBands({ rows }: { rows: EventRow[] }) {
  const bands = bandDay(rows);
  const fold = rows.length > WEEK_COLUMN_FOLD_AT;
  return (
    <div className="list">
      {bands.map((band) => (
        <details className="band" key={band.key} open={!fold || band.open > 0}>
          <summary>
            <span className="bn">{band.label}</span>
            <span className={classes('bc', band.open === 0 && !band.allCancelled && 'ok')}>
              {band.allCancelled
                ? `${band.events.length} ev · cancelled`
                : formatCounter(band.events.length, band.open)}
            </span>
          </summary>
          <div className="bl">
            {band.events.map((row) => (
              <WeekChip key={row.id} row={row} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function WeekChip({ row }: { row: EventRow }) {
  return (
    <Link
      className={classes(
        'wchip',
        row.status === 'cancelled' && 'cancelled',
        row.status === 'ongoing' && 'ongoing',
        row.status !== 'cancelled' && fillTone(row) === 'green' && 'full',
      )}
      href={`/events/${row.id}`}
    >
      <span className="w">
        {row.windowLabel}
        <ChipStatus status={row.status} />
        {row.status !== 'cancelled' ? <span className="f">{formatEventFill(row.fill)}</span> : null}
      </span>
      <span className="n">{row.title}</span>
      <span className="m">
        {row.clientName} · {row.venueName}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------

export function DayView({ rows }: { rows: EventRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <div className="empty">Nothing on this day.</div>
      </Panel>
    );
  }

  return (
    <div className="stack tight">
      {rows.map((row) => {
        const open = formatOpen(row.fill);
        return (
          <Link
            key={row.id}
            href={`/events/${row.id}`}
            className={classes('dayrow', row.status === 'cancelled' && 'cancelled')}
          >
            <span className="w">
              {row.windowIso ? (
                <ScheduledWindow startsAt={row.windowIso.startsAt} endsAt={row.windowIso.endsAt} />
              ) : (
                row.windowLabel
              )}
              {row.endsNextDay ? <span className="sub">ends next day</span> : null}
            </span>
            <span>
              <b>{row.title}</b>
              {row.poNumber ? <span className="sub mono">PO {row.poNumber}</span> : null}
            </span>
            <span>
              {row.clientName}
              <span className="sub">{row.venueName}</span>
            </span>
            <span className="row wrap">
              {row.roles.map((role, index) => (
                <span className="chip" key={`${row.id}-${index}`}>
                  {role.roleName} {formatAllocation(role.headcount, role.buffer)}
                </span>
              ))}
            </span>
            <span>
              {row.status === 'cancelled' ? null : (
                <>
                  <Pill tone={fillTone(row) === 'green' ? 'green' : 'amber'}>
                    {formatEventFill(row.fill)}
                  </Pill>
                  {open ? <span className="sub">{open}</span> : null}
                </>
              )}
            </span>
            <span>
              <StatusPill status={row.status} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
