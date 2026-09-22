import { UK_ZONE, formatAllocation } from '@thc/domain';
import type { Tone } from '@thc/ui';

/**
 * Shapes and formatting for /dashboard — Scope §9.1.
 *
 * Pure functions only, and no arithmetic that decides anything: the money,
 * the fill and the margin are all computed by
 * `20260922180000_dashboard_kpis.sql`. What is here is how they read, and
 * how the flat section rows are grouped into events.
 *
 * It is a separate file from `data.ts` so it can be unit-tested: `data.ts`
 * imports `next/headers`, which only exists inside a request.
 *
 * `formatAllocation` is imported rather than re-written because "6 (+1)"
 * is a rule, not a layout choice: the buffer is absolute and is never
 * collapsed into the headcount (§3.2).
 */

// ---------------------------------------------------------------------
// What the screen renders
// ---------------------------------------------------------------------

/** The four "as of this minute" counters (§9.1). */
export interface Kpis {
  asOf: string;
  openPositions: number;
  onShiftNow: number;
  staffAvailable: number;
  complianceBlocks: number;
}

/** The current Mon–Sun week, forecast from the events as built (§9.1). */
export interface WeekFinance {
  weekStart: string;
  weekEnd: string;
  events: number;
  forecastHours: number;
  chargeTotal: number;
  baseTotal: number;
  /** The +12.07% element on its own. Never added into `baseTotal` (§1.5). */
  holidayTotal: number;
  payTotal: number;
  marginTotal: number;
  /** Null, never 0, when the week is empty: no work is not a zero margin. */
  marginPct: number | null;
}

/** One role section on the ten-day list. §9.1 puts the margin on this row. */
export interface UpcomingRole {
  shiftId: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  buffer: number;
  confirmed: number;
  openPositions: number;
  marginPerHour: number;
}

/** One event on the ten-day list, with its role sections under it. */
export interface UpcomingEvent {
  eventId: string;
  title: string;
  eventDate: string;
  clientName: string;
  venueName: string;
  poNumber: string | null;
  cancelledAt: string | null;
  /** Derived: min section start → max section end (RULE-18). */
  startsAt: string;
  endsAt: string;
  roles: UpcomingRole[];
}

// ---------------------------------------------------------------------
// What the database returns
// ---------------------------------------------------------------------

export interface KpiRow {
  as_of: string;
  open_positions: number;
  on_shift_now: number;
  staff_available: number;
  compliance_blocks: number;
}

export interface FinanceRow {
  week_start: string;
  week_end: string;
  events: number;
  forecast_hours: number | string;
  charge_total: number | string;
  base_total: number | string;
  holiday_total: number | string;
  pay_total: number | string;
  margin_total: number | string;
  margin_pct: number | string | null;
}

export interface UpcomingRow {
  shift_id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  client_name: string;
  venue_name: string;
  po_number: string | null;
  cancelled_at: string | null;
  role_name: string;
  starts_at: string;
  ends_at: string;
  event_starts_at: string;
  event_ends_at: string;
  headcount: number;
  buffer: number;
  confirmed: number;
  open_positions: number;
  margin_per_hour: number | string;
}

/**
 * Postgres returns `numeric` as a string over PostgREST, deliberately: it
 * does not fit a double without loss. Every money column here is pence-
 * precise already, so parsing is safe — but it has to be explicit, because
 * `'300.00' + 0` is not what anyone wants on an invoice line.
 */
export function money(value: number | string | null): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

/**
 * Flat section rows → one entry per event with its roles under it.
 *
 * The rows arrive already ordered by the query, so this preserves the
 * order it is given rather than sorting again: two sorts of the same list
 * is how two screens end up disagreeing about which event is first.
 */
export function groupByEvent(rows: UpcomingRow[]): UpcomingEvent[] {
  const byEvent = new Map<string, UpcomingEvent>();

  for (const row of rows) {
    let event = byEvent.get(row.event_id);
    if (!event) {
      event = {
        eventId: row.event_id,
        title: row.event_title,
        eventDate: row.event_date,
        clientName: row.client_name,
        venueName: row.venue_name,
        poNumber: row.po_number,
        cancelledAt: row.cancelled_at,
        startsAt: row.event_starts_at,
        endsAt: row.event_ends_at,
        roles: [],
      };
      byEvent.set(row.event_id, event);
    }
    event.roles.push({
      shiftId: row.shift_id,
      roleName: row.role_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      headcount: row.headcount,
      buffer: row.buffer,
      confirmed: row.confirmed,
      openPositions: row.open_positions,
      marginPerHour: money(row.margin_per_hour),
    });
  }

  return [...byEvent.values()];
}

// ---------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------

/** "£48,920" — whole pounds, which is how the panel totals are drawn. */
export function formatPounds(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

/** "£7.28" — to the penny, for a rate. */
export function formatRate(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * "+£7.28/h" — §9.1's margin on a role row, shown in green.
 *
 * The sign is explicit because the number is a margin, not a price, and a
 * negative one is a role THC is losing money on. That is worth seeing as
 * "−£1.20/h" rather than as a quietly smaller green number, so the tone
 * comes from `marginTone` rather than being green by assumption.
 */
export function formatMarginPerHour(value: number): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign}${formatRate(Math.abs(value))}/h`;
}

export function marginTone(value: number): Tone {
  return value < 0 ? 'coral' : 'green';
}

/** "1,864" — the forecast panel's hours. */
export function formatHours(value: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value);
}

/** "35.8%", or a dash for a week with nothing in it. */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

// ---------------------------------------------------------------------
// Dates and times (§1.8)
// ---------------------------------------------------------------------

/**
 * Day and month names are literals, not `Intl` short forms, for the same
 * reason `apps/office/app/events/calendar.ts` spells them out: en-GB's
 * CLDR data renders September as "Sept" and puts a comma after the
 * weekday, and which of those an environment does depends on its ICU
 * version. The wireframes say "Fri 19 Sep" and a date label must not
 * depend on the Node build.
 */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Dates on this screen are date-only strings (`2026-09-25`), which carry no
 * zone at all, so they are read in UTC: `new Date('2026-09-25')` is
 * midnight UTC, and interpreting that in a zone behind London would move
 * it to the 24th. A calendar date must not move.
 */
function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function weekday(date: Date): string {
  // getUTCDay() is Sunday-first; the platform's weeks are Monday-first.
  return WEEKDAYS[(date.getUTCDay() + 6) % 7]!;
}

/** "Fri 25 Sep". */
export function formatDayLabel(isoDate: string): string {
  const date = utcDate(isoDate);
  return `${weekday(date)} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "today" / "tomorrow", or null for anything further out. */
export function relativeDayLabel(isoDate: string, todayIso: string): string | null {
  if (isoDate === todayIso) return 'today';
  const tomorrow = utcDate(todayIso);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return isoDate === tomorrow.toISOString().slice(0, 10) ? 'tomorrow' : null;
}

/** "Mon 21 – Sun 27 Sep" — the §9.1 week, as the panel header states it. */
export function formatWeekRange(startIso: string, endIso: string): string {
  const start = utcDate(startIso);
  const end = utcDate(endIso);
  // The month is named once when the week sits inside one, and twice when
  // it straddles two — otherwise "Mon 28 – Sun 4 Oct" reads as September.
  const head =
    start.getUTCMonth() === end.getUTCMonth()
      ? `${weekday(start)} ${start.getUTCDate()}`
      : formatDayLabel(startIso);
  return `${head} – ${formatDayLabel(endIso)}`;
}

/** Today in Europe/London, as `YYYY-MM-DD`. Matches the SQL's own window. */
export function todayInUk(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: UK_ZONE }).format(now);
}

/** "as of 14:32 UK time · Thu 24 Sep 2026" — the §9.1 "this minute" stamp. */
export function formatAsOf(instant: Date): { time: string; date: string } {
  const ukDate = todayInUk(instant);
  return {
    time: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: UK_ZONE,
    }).format(instant),
    date: `${formatDayLabel(ukDate)} ${ukDate.slice(0, 4)}`,
  };
}

// ---------------------------------------------------------------------
// Fill (§3.2)
// ---------------------------------------------------------------------

export interface FillChip {
  label: string;
  tone: Tone;
}

/**
 * "9 of 12" and its colour.
 *
 * Confirmed against HEADCOUNT — never against headcount + buffer, and never
 * counting an invitation (§3.2). Green once the headcount is met; below
 * that, amber while more than half the seats are confirmed and coral at or
 * below half, which is the banding the design board draws.
 */
export function fillChip(confirmed: number, headcount: number): FillChip {
  const label = `${confirmed} of ${headcount}`;
  if (headcount === 0) return { label, tone: 'neutral' };
  if (confirmed >= headcount) return { label, tone: 'green' };
  return { label, tone: confirmed / headcount > 0.5 ? 'amber' : 'coral' };
}

/** "6 (+1)" — the allocation, with the buffer always beside it, never in it. */
export function allocationLabel(headcount: number, buffer: number): string {
  return formatAllocation(headcount, buffer);
}
