/**
 * What the list and the calendar actually render — Scope §3.1.
 *
 * Kept pure and apart from the components so the fill arithmetic, the status
 * and the ordering can be tested without a database or a browser. Every rule
 * it leans on comes from `@thc/domain`: the derived window (RULE-18), the
 * status (§1.5) and the fill (§3.2).
 */

import {
  type EventFill,
  type EventStatus,
  type RoleSectionWindow,
  type TimeFormat,
  UK_ZONE,
  cancelledFinanceNote,
  ukDayLabel,
  ukInstant,
  derivedEventWindow,
  EVENT_STATUS_LABEL,
  eventFill,
  formatEventFill,
  eventStatus,
  formatTimeIn,
  needsDualZone,
  ukRoleWindow,
} from '@thc/domain';
import type { ListedEvent } from './data';

/**
 * A scheduled window as §1.8 displays it: UK time always, and a second
 * "your time" line only when the viewer is not in Europe/London. The same
 * helpers the dashboard and the check-in monitor use (`formatTimeIn`,
 * `needsDualZone`); this only fixes the separator the /events screens use.
 */
export function scheduledWindowLines(
  startsAt: Date,
  endsAt: Date,
  zone: string,
  format?: TimeFormat,
): { uk: string; local: string | null } {
  const at = (instant: Date, z: string) => formatTimeIn(instant, z, format);
  const uk = `${at(startsAt, UK_ZONE)} – ${at(endsAt, UK_ZONE)}`;
  if (!needsDualZone(zone)) return { uk, local: null };
  return { uk, local: `${at(startsAt, zone)} – ${at(endsAt, zone)} your time` };
}

/** A role on a list row, with its own window as instants for the zone line (§1.8). */
export type EventRowRole = ListedEvent['roles'][number] & { startsAt: string; endsAt: string };

export interface EventRow {
  id: string;
  title: string;
  date: string;
  clientId: string;
  clientName: string;
  venueName: string;
  venueAddress: string;
  poNumber: string;
  cancelReason: string;
  status: EventStatus;
  /**
   * A cancelled event's finance line (§3.3): before the day it is excluded
   * from financials; on the day (UK) the scheduled hours are billed and
   * paid. Null unless cancelled.
   */
  cancelledNote: string | null;
  fill: EventFill;
  /** The derived window, or null while the event has no role sections. */
  window: RoleSectionWindow | null;
  /** "07:00 – 23:30" in UK time (or "7:00 am – 11:30 pm", ADR-0085), or "—". */
  windowLabel: string;
  /** The window's start alone, for a calendar chip: "07:00", or "—". */
  windowStartLabel: string;
  /** The derived window as ISO instants, for the "your time" line; null without roles. */
  windowIso: { startsAt: string; endsAt: string } | null;
  /** Set when the window runs past midnight: "ends Sat 20". */
  endsNextDay: boolean;
  roles: EventRowRole[];
}

/** Sort key: events within a day read in window order (§3.1 week view). */
function startedAt(row: EventRow): number {
  return row.window ? row.window.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
}

export function toEventRow(
  event: ListedEvent,
  now: Date = new Date(),
  format?: TimeFormat,
): EventRow {
  const sections = event.roles.map((role) => ukRoleWindow(event.date, role.start, role.end));
  const window = derivedEventWindow(sections);

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    clientId: event.clientId,
    clientName: event.clientName,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    poNumber: event.poNumber,
    cancelReason: event.cancelReason,
    status: eventStatus(window, event.cancelledAt, now),
    cancelledNote: event.cancelledAt ? cancelledFinanceNote(event.cancelledAt, event.date) : null,
    fill: eventFill(event.roles),
    window,
    windowLabel: window
      ? `${formatTimeIn(window.startsAt, UK_ZONE, format)} – ${formatTimeIn(window.endsAt, UK_ZONE, format)}`
      : '—',
    windowStartLabel: window ? formatTimeIn(window.startsAt, UK_ZONE, format) : '—',
    windowIso: window
      ? { startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() }
      : null,
    // The window is stored as instants, so "past midnight" is a comparison
    // against the event's own date rather than a clock reading (§3.2).
    endsNextDay: window
      ? window.endsAt.toISOString().slice(0, 10) > utcDayOf(window.startsAt)
      : false,
    roles: event.roles.map((role, index) => ({
      ...role,
      startsAt: sections[index]!.startsAt.toISOString(),
      endsAt: sections[index]!.endsAt.toISOString(),
    })),
  };
}

function utcDayOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function toEventRows(
  events: ListedEvent[],
  now: Date = new Date(),
  format?: TimeFormat,
): EventRow[] {
  return events
    .map((event) => toEventRow(event, now, format))
    .sort((a, b) => (a.date === b.date ? startedAt(a) - startedAt(b) : a.date < b.date ? -1 : 1));
}

export interface EventFilters {
  /** `clients.id`, from the toolbar's Client select; '' for all. */
  clientId: string;
  status: string;
  q: string;
}

/**
 * The toolbar's filters (§3.1). Client matches on the id: two clients may
 * share a display name (a hotel group's properties often do), and a match
 * on the name showed both clients' events under either.
 */
export function filterEventRows(rows: EventRow[], filters: EventFilters): EventRow[] {
  const needle = filters.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (!needle) return true;
    return [row.title, row.clientName, row.venueName, row.poNumber]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

export interface DayBucket {
  iso: string;
  events: EventRow[];
  /** Events and open positions for the "N ev · M open" counter. */
  count: number;
  open: number;
  /** A day whose only events are cancelled reads "1 ev · cancelled". */
  allCancelled: boolean;
}

/** Groups rows by their own date, for the month and week cells (§3.1). */
export function bucketByDay(rows: EventRow[], days: string[]): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>(
    days.map((iso) => [iso, { iso, events: [], count: 0, open: 0, allCancelled: false }]),
  );

  for (const row of rows) {
    const bucket = buckets.get(row.date);
    if (!bucket) continue;
    bucket.events.push(row);
    bucket.count += 1;
    // A cancelled event is out of the staffing picture, so its unfilled
    // headcount is not something anyone still has to fill (§3.1).
    if (row.status !== 'cancelled') bucket.open += row.fill.open;
  }

  for (const bucket of buckets.values()) {
    bucket.allCancelled =
      bucket.count > 0 && bucket.events.every((event) => event.status === 'cancelled');
  }
  return buckets;
}

/** The totals under the list: "13 events in September · 45 open positions". */
export function periodTotals(rows: EventRow[]): { events: number; open: number } {
  return {
    events: rows.length,
    open: rows.reduce((sum, row) => (row.status === 'cancelled' ? sum : sum + row.fill.open), 0),
  };
}

/**
 * One month-cell chip: events that read the same ("Morning Waiting Staff" for one
 * client at 07:00) collapse into one chip with a count and their summed open positions
 * (ADR-0094). A group of one is the event itself.
 */
export interface ChipGroup {
  key: string;
  rows: EventRow[];
  startLabel: string;
  /** Open positions across the group; a cancelled event contributes none. */
  open: number;
  cancelled: boolean;
}

/**
 * Collapses same-title, same-client, same-start events in a day, in first-seen
 * order (§3.1's chip is "start · event · client", so two clients never merge) — the
 * rows arrive sorted by window start, so the chips still read in time order.
 * A cancelled event never joins a live one: its strike-through and its zero
 * open count must stay visible.
 */
export function groupSimilarEvents(rows: EventRow[]): ChipGroup[] {
  const groups = new Map<string, ChipGroup>();
  for (const row of rows) {
    const cancelled = row.status === 'cancelled';
    const key = `${row.title.trim().toLowerCase()}|${row.clientId}|${row.windowStartLabel}|${cancelled}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      if (!cancelled) group.open += row.fill.open;
    } else {
      groups.set(key, {
        key,
        rows: [row],
        startLabel: row.windowStartLabel,
        open: cancelled ? 0 : row.fill.open,
        cancelled,
      });
    }
  }
  return [...groups.values()];
}

/** Chips a month cell draws before it says "+N more" and sends you to the day. */
export const MONTH_CELL_CHIPS = 3;

export interface MonthCell {
  shown: ChipGroup[];
  /** Events (not chips) left out, and the open positions among them. */
  hiddenEvents: number;
  hiddenOpen: number;
}

/**
 * What a month cell draws. At most `limit` chips — never a scroll box inside
 * a cell — and the rest as "+N more". A day that overflows by a single chip
 * shows it instead, since "+1 more" is no shorter than the chip it hides.
 */
export function monthCell(rows: EventRow[], limit: number = MONTH_CELL_CHIPS): MonthCell {
  const groups = groupSimilarEvents(rows);
  if (groups.length <= limit + 1) return { shown: groups, hiddenEvents: 0, hiddenOpen: 0 };
  const hidden = groups.slice(limit);
  return {
    shown: groups.slice(0, limit),
    hiddenEvents: hidden.reduce((sum, g) => sum + g.rows.length, 0),
    hiddenOpen: hidden.reduce((sum, g) => sum + g.open, 0),
  };
}

/** One row of the day popup — plain data, so it can cross to a client component. */
export interface PopupEvent {
  id: string;
  title: string;
  clientName: string;
  venueName: string;
  windowLabel: string;
  status: EventStatus;
  /** "N of M" (§3.1), or null once cancelled. */
  fill: string | null;
  tone: 'green' | 'amber' | 'neutral';
}

export function popupEvent(row: EventRow): PopupEvent {
  return {
    id: row.id,
    title: row.title,
    clientName: row.clientName,
    venueName: row.venueName,
    windowLabel: row.windowLabel,
    status: row.status,
    fill: row.status === 'cancelled' ? null : formatEventFill(row.fill),
    tone: fillTone(row),
  };
}

/** A month-cell chip as the client component draws it. */
export interface MonthChipModel {
  key: string;
  startLabel: string;
  label: string;
  tooltip: string;
  /** The shared status, or null when a group mixes statuses. */
  status: EventStatus | null;
  /** "full", "4 open", or null for a cancelled chip. */
  fill: string | null;
  cancelled: boolean;
  ongoing: boolean;
  full: boolean;
  /** A single event's board; null for a group, which opens the day popup. */
  href: string | null;
}

export interface MonthCellModel {
  chips: MonthChipModel[];
  hiddenEvents: number;
  hiddenOpen: number;
  /** Every event that day, for the popup. */
  events: PopupEvent[];
}

/** What a month cell and its popup draw (ADR-0094). */
export function monthCellModel(rows: EventRow[], limit: number = MONTH_CELL_CHIPS): MonthCellModel {
  const { shown, hiddenEvents, hiddenOpen } = monthCell(rows, limit);
  return {
    chips: shown.map((group) => {
      const first = group.rows[0]!;
      const many = group.rows.length > 1;
      const live = group.rows.filter((row) => row.status !== 'cancelled');
      const statuses = new Set(group.rows.map((row) => row.status));
      return {
        key: group.key,
        startLabel: group.startLabel,
        label: many
          ? `${first.title} ×${group.rows.length} · ${first.clientName}`
          : `${first.title} · ${first.clientName}`,
        tooltip: many
          ? `${group.rows.length} × ${first.title} · ${first.clientName}`
          : `${first.title} · ${first.clientName} · ${EVENT_STATUS_LABEL[first.status]}`,
        status: statuses.size === 1 ? first.status : null,
        fill: group.cancelled ? null : group.open > 0 ? `${group.open} open` : 'full',
        cancelled: group.cancelled,
        ongoing: group.rows.some((row) => row.status === 'ongoing'),
        full: !group.cancelled && live.every((row) => fillTone(row) === 'green'),
        href: many ? null : `/events/${first.id}`,
      };
    }),
    hiddenEvents,
    hiddenOpen,
    events: rows.map(popupEvent),
  };
}

export type DayBandKey = 'overnight' | 'morning' | 'afternoon' | 'evening' | 'unscheduled';

export const DAY_BAND_LABEL: Record<DayBandKey, string> = {
  overnight: 'Overnight',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  unscheduled: 'No roles yet',
};

const DAY_BAND_ORDER: DayBandKey[] = [
  'overnight',
  'morning',
  'afternoon',
  'evening',
  'unscheduled',
];

const UK_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * The band an event starts in, by the UK hour of its derived window start
 * (RULE-18 / §1.8: rules read in Europe/London). A band is a way to fold a
 * long column, not a time grid: events keep their list order inside it.
 */
export function dayBandOf(row: EventRow): DayBandKey {
  if (!row.window) return 'unscheduled';
  const hour = Number(UK_HOUR.format(row.window.startsAt));
  if (hour < 5) return 'overnight';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export interface DayBand {
  key: DayBandKey;
  label: string;
  events: EventRow[];
  open: number;
  /** Every event in the band is cancelled — it reads "1 ev · cancelled", as a month cell does. */
  allCancelled: boolean;
}

/** A week column's events folded into the bands that have any, in day order. */
export function bandDay(rows: EventRow[]): DayBand[] {
  const bands = new Map<DayBandKey, DayBand>();
  for (const row of rows) {
    const key = dayBandOf(row);
    const band = bands.get(key) ?? {
      key,
      label: DAY_BAND_LABEL[key],
      events: [],
      open: 0,
      allCancelled: true,
    };
    band.events.push(row);
    if (row.status !== 'cancelled') {
      band.open += row.fill.open;
      band.allCancelled = false;
    }
    bands.set(key, band);
  }
  return DAY_BAND_ORDER.flatMap((key) => bands.get(key) ?? []);
}

/** A column this short never folds: nothing to save by hiding it. */
export const WEEK_COLUMN_FOLD_AT = 8;

/** The tone the chip and the fill pill carry (§3.1). */
export function fillTone(row: EventRow): 'green' | 'amber' | 'neutral' {
  if (row.status === 'cancelled') return 'neutral';
  return row.fill.open === 0 ? 'green' : 'amber';
}

/**
 * The page crumb's period — "Thu 18 Sep 2026", the wireframe's
 * "events · Thu 18 Sep 2026" — for the UK day the calendar is anchored on.
 * Read at UK noon, so a date near a clock change can never slip a day.
 */
export function periodCrumb(date: string): string {
  return `${ukDayLabel(ukInstant(date, '12:00'))} ${date.slice(0, 4)}`;
}
