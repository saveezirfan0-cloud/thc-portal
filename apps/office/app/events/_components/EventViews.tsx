import Link from 'next/link';
import { Panel, Pill } from '@thc/ui';
import {
  EVENT_STATUS_LABEL,
  type EventStatus,
  formatAllocation,
  formatCounter,
  formatEventFill,
  formatHours,
  formatOpen,
  sectionHours,
} from '@thc/domain';
import { formatDayShort, weekdayIndex } from '../calendar';
import { type DayBucket, type EventRow, cancelledLine, fillTone } from '../view-model';
import { ClickableRow } from './ClickableRow';
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

/** The chip's fill word: "full", "4 open", or nothing once cancelled. */
export function chipFill(row: EventRow): string | null {
  if (row.status === 'cancelled') return null;
  return formatOpen(row.fill) ?? 'full';
}

/**
 * The chip classes the month and week calendars share: `full` only when
 * nothing is open and the event is live, `ongoing` from the status, and
 * `cancelled`. An ongoing event that is short stays amber — the wireframe's
 * ongoing chip is green because it is "10 of 10", not because it is ongoing.
 */
export function chipClasses(kind: 'evchip' | 'wchip', row: EventRow): string {
  return classes(
    kind,
    row.status === 'cancelled' && 'cancelled',
    row.status === 'ongoing' && 'ongoing',
    row.status !== 'cancelled' && fillTone(row) === 'green' && 'full',
  );
}

/**
 * A role's own fill pill — "4 of 4" green, "3 of 4" amber — as the day
 * rows carry one per role (events.html:322). Confirmed is capped at
 * headcount the way the event fill is (§3.2).
 */
export function roleFill(role: { confirmed: number; headcount: number }): {
  text: string;
  tone: 'green' | 'amber';
} {
  const confirmed = Math.min(role.confirmed, role.headcount);
  return {
    text: `${confirmed} of ${role.headcount}`,
    tone: confirmed >= role.headcount ? 'green' : 'amber',
  };
}

/**
 * The sub-line under a day row's window: "starts in 28 min" while the
 * start is within the hour, else the window's length ("12 h window").
 */
export function windowSubline(row: EventRow, now: Date = new Date()): string | null {
  if (!row.window || row.status === 'cancelled') return null;
  const untilStartMin = Math.round((row.window.startsAt.getTime() - now.getTime()) / 60_000);
  if (row.status === 'upcoming' && untilStartMin >= 0 && untilStartMin <= 60) {
    return `starts in ${untilStartMin} min`;
  }
  return `${formatHours(sectionHours(row.window))} window`;
}

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

  return (
    <table className="tbl">
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
          const cells = (
            <>
              <td>
                <b className={row.date === today ? 'cyan' : undefined}>
                  {formatDayShort(row.date)}
                </b>
                {row.date === today ? <span className="sub">today</span> : null}
              </td>
              <td className={cancelled ? 'muted' : undefined}>
                {cancelled ? (
                  <s>{row.title}</s>
                ) : (
                  <Link href={`/events/${row.id}`}>
                    <b>{row.title}</b>
                  </Link>
                )}
                {cancelled ? <span className="sub">{cancelledLine(row)}</span> : null}
              </td>
              <td className={cancelled ? 'muted' : undefined}>
                {row.clientName}
                <span className="sub">{row.venueName}</span>
              </td>
              <td className={classes('mono', 'sm', cancelled && 'muted')}>
                {/* The column header carries the zone; a reader outside the
                    UK gets the "your time" line beneath (§1.8). */}
                {row.window ? (
                  <ScheduledWindow startsAt={row.window.startsAt} endsAt={row.window.endsAt} />
                ) : (
                  '—'
                )}
                {row.endsLabel ? <span className="sub">{row.endsLabel}</span> : null}
              </td>
              <td>
                <div className="roles">
                  {row.roles.map((role, index) => (
                    <div className="r" key={`${row.id}-${index}`}>
                      <span className="chip">{role.roleName}</span>
                      <span className="mono">
                        {role.start}–{role.end}
                      </span>
                      <span className="mono">{formatAllocation(role.headcount, role.buffer)}</span>
                    </div>
                  ))}
                  {row.roles.length === 0 ? <span className="muted sm">No roles yet</span> : null}
                </div>
              </td>
              <td>
                {cancelled ? (
                  <span className="muted sm">excluded from financials</span>
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
              <td>
                <StatusPill status={row.status} />
              </td>
              <td className={classes('mono', 'sm', !row.poNumber && 'muted')}>
                {row.poNumber || '—'}
              </td>
            </>
          );
          // The whole row opens the board, as the wireframe's onclick does —
          // the cursor `.clickable` shows must not promise what only the
          // title delivered. A cancelled row has no board to go to.
          return cancelled ? (
            <tr key={row.id}>{cells}</tr>
          ) : (
            <ClickableRow key={row.id} href={`/events/${row.id}`} className="clickable">
              {cells}
            </ClickableRow>
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

/** The month toolbar's key: full green · N open amber · cancelled (events.html:193). */
export function MonthLegend() {
  return (
    <span className="row legend-chips" aria-label="Legend">
      <span className="evchip full">
        <span className="t">full</span>green
      </span>
      <span className="evchip">
        <span className="t">N open</span>amber
      </span>
      <span className="evchip cancelled">cancelled</span>
    </span>
  );
}

export function MonthView({
  cells,
  buckets,
  today,
}: {
  cells: { iso: string; dayOfMonth: number; inMonth: boolean }[];
  buckets: Map<string, DayBucket>;
  today: string;
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
        const count = bucket?.count ?? 0;
        return (
          <div
            key={cell.iso}
            className={classes('day', !cell.inMonth && 'other', cell.iso === today && 'today')}
          >
            <div className="d">
              {cell.dayOfMonth}
              {/* An in-month day with nothing on it still says "0 ev"; only
                  the neighbours' spill days stay bare (events.html:204). */}
              {count > 0 ? (
                <span className="cnt">
                  {bucket!.allCancelled
                    ? `${count} ev · cancelled`
                    : formatCounter(count, bucket!.open)}
                </span>
              ) : cell.inMonth ? (
                <span className="cnt">0 ev</span>
              ) : null}
            </div>
            {bucket && bucket.events.length > 0 ? (
              <div className="scroll">
                {bucket.events.map((row) => (
                  <MonthChip key={row.id} row={row} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function MonthChip({ row }: { row: EventRow }) {
  const fill = chipFill(row);
  return (
    <Link
      className={chipClasses('evchip', row)}
      href={`/events/${row.id}`}
      title={`${row.title} · ${row.clientName}`}
    >
      <span className="t">{row.window ? row.windowLabel.slice(0, 5) : '—'}</span>
      {row.title} · {row.clientName}
      {fill ? <span className="f">{fill}</span> : null}
    </Link>
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
        // A day whose only events are cancelled reads "1 ev · cancelled" in
        // amber, as the month cell does (events.html:300) — not "0 open".
        const allCancelled = bucket?.allCancelled ?? false;
        return (
          <div className={classes('col', iso === today && 'today')} key={iso}>
            <div className="ch">
              <span className="d">
                {WEEKDAY_HEADS[weekdayIndex(iso)]} {Number(iso.slice(8, 10))}
                {iso === today ? ' · today' : ''}
              </span>
              <span className={classes('c', open === 0 && !allCancelled && 'ok')}>
                {count === 0
                  ? '0 ev'
                  : allCancelled
                    ? `${count} ev · cancelled`
                    : formatCounter(count, open)}
              </span>
            </div>
            <div className="list">
              {(bucket?.events ?? []).map((row) => (
                <WeekChip key={row.id} row={row} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WeekChip({ row }: { row: EventRow }) {
  const cancelled = row.status === 'cancelled';
  return (
    <Link className={chipClasses('wchip', row)} href={`/events/${row.id}`}>
      <span className="w">
        {row.window ? (
          <ScheduledWindow startsAt={row.window.startsAt} endsAt={row.window.endsAt} />
        ) : (
          '—'
        )}
        {!cancelled ? <span className="f">{formatEventFill(row.fill)}</span> : null}
      </span>
      <span className="n">
        {row.title}
        {/* §3.2: the status pill sits on the row in every view; the week
            chip draws it for the ongoing state (events.html:271). */}
        {row.status === 'ongoing' ? <StatusPill status={row.status} /> : null}
      </span>
      <span className="m">
        {row.clientName} · {row.venueName}
      </span>
      {cancelled ? (
        <span className="m">{cancelledLine(row)} — stays visible, greyed (§3.3)</span>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------

/** The day toolbar's right-hand pills: "3 ev · 0 open" and "1 ongoing" (events.html:207). */
export function DayPills({ rows }: { rows: EventRow[] }) {
  const live = rows.filter((row) => row.status !== 'cancelled');
  const open = live.reduce((sum, row) => sum + row.fill.open, 0);
  const ongoing = rows.filter((row) => row.status === 'ongoing').length;
  return (
    <>
      <Pill tone="cyan">{formatCounter(rows.length, open)}</Pill>
      {ongoing > 0 ? (
        <Pill tone="green" dot>
          {ongoing} ongoing
        </Pill>
      ) : null}
    </>
  );
}

export function DayView({ rows, now }: { rows: EventRow[]; now?: Date }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <div className="empty">Nothing on this day.</div>
      </Panel>
    );
  }

  return (
    <div className="stack tight">
      <div className="dayrow head" aria-hidden="true">
        <span className="label">Window (UK time)</span>
        <span className="label">Event</span>
        <span className="label">Client · Venue</span>
        <span className="label">Roles · headcount (+buffer)</span>
        <span className="label">Fill</span>
        <span className="label">Status</span>
      </div>
      {rows.map((row) => {
        const open = formatOpen(row.fill);
        const cancelled = row.status === 'cancelled';
        const subline = windowSubline(row, now);
        return (
          <Link
            key={row.id}
            href={`/events/${row.id}`}
            className={classes('dayrow', cancelled && 'cancelled')}
          >
            <span className="w">
              {row.window ? (
                <ScheduledWindow startsAt={row.window.startsAt} endsAt={row.window.endsAt} />
              ) : (
                '—'
              )}
              {row.endsLabel ? <span className="sub">{row.endsLabel}</span> : null}
              {subline ? <span className="sub">{subline}</span> : null}
            </span>
            <span>
              <b>{row.title}</b>
              {row.poNumber || row.onsiteContact ? (
                <span className="sub">
                  {row.poNumber ? <span className="mono">PO {row.poNumber}</span> : null}
                  {row.poNumber && row.onsiteContact ? ' · ' : ''}
                  {row.onsiteContact ? `on-site: ${row.onsiteContact}` : ''}
                </span>
              ) : null}
              {cancelled ? <span className="sub">{cancelledLine(row)}</span> : null}
            </span>
            <span>
              {row.clientName}
              <span className="sub">
                {row.venueName}
                {row.venueAddress ? `, ${row.venueAddress}` : ''}
                {row.geofenceRadiusM ? ` · geofence ${row.geofenceRadiusM} m` : ''}
              </span>
            </span>
            {/* §3.2: each role's own times wherever the role appears, and a
                fill pill per role (events.html:322). */}
            <span className="stack tight">
              {row.roles.map((role, index) => {
                const fill = roleFill(role);
                return (
                  <span className="row sm roleline" key={`${row.id}-${index}`}>
                    <span className="chip">{role.roleName}</span>
                    <span className="mono">
                      {role.start}–{role.end}
                    </span>
                    <span className="mono">{formatAllocation(role.headcount, role.buffer)}</span>
                    {cancelled ? null : <Pill tone={fill.tone}>{fill.text}</Pill>}
                  </span>
                );
              })}
              {row.roles.length === 0 ? <span className="muted sm">No roles yet</span> : null}
            </span>
            <span>
              {cancelled ? null : (
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
