/**
 * Calendar arithmetic for /events — Scope §3.1.
 *
 * Dates here are plain "YYYY-MM-DD" civil dates, never instants: which cell a
 * Friday event sits in is a calendar question, not a time-zone one, so the
 * maths runs in UTC where a day is always 24 hours and cannot drift across a
 * BST changeover. The one place the zone matters is "today", which has to be
 * today in Europe/London however the server is set (§1.8).
 */

import { UK_ZONE } from '@thc/domain';

export type CalendarView = 'list' | 'month' | 'week' | 'day';

export const CALENDAR_VIEWS: CalendarView[] = ['list', 'month', 'week', 'day'];

export function isCalendarView(value: string | undefined): value is CalendarView {
  return value !== undefined && (CALENDAR_VIEWS as string[]).includes(value);
}

/** Today in Europe/London, as a civil date. */
export function todayInUk(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UK_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

function toUtc(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

export function addMonths(iso: string, months: number): string {
  const date = toUtc(iso);
  const targetMonth = date.getUTCMonth() + months;
  const wanted = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = new Date(
    Date.UTC(wanted.getUTCFullYear(), wanted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  wanted.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toIso(wanted);
}

/** 0 = Monday … 6 = Sunday. The week runs Mon–Sun throughout (§3.1). */
export function weekdayIndex(iso: string): number {
  return (toUtc(iso).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const date = toUtc(iso);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/** The seven civil dates of the week `iso` falls in, Monday first. */
export function weekDays(iso: string): string[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export interface MonthCell {
  iso: string;
  dayOfMonth: number;
  /** False for the leading and trailing days that belong to the neighbours. */
  inMonth: boolean;
}

/**
 * The month grid: whole Mon–Sun weeks covering the month, so the first row
 * starts on a Monday and the last ends on a Sunday. Five or six rows
 * depending on where the month falls.
 */
export function monthGrid(iso: string): MonthCell[] {
  const first = startOfMonth(iso);
  const last = endOfMonth(iso);
  const month = iso.slice(0, 7);

  const cells: MonthCell[] = [];
  let cursor = startOfWeek(first);
  const stop = addDays(startOfWeek(last), 7);

  while (cursor < stop) {
    cells.push({
      iso: cursor,
      dayOfMonth: Number(cursor.slice(8, 10)),
      inMonth: cursor.slice(0, 7) === month,
    });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

/** The civil dates a view covers, so the loader fetches exactly those events. */
export function periodRange(view: CalendarView, iso: string): { from: string; to: string } {
  if (view === 'day') return { from: iso, to: iso };
  if (view === 'week') {
    const days = weekDays(iso);
    return { from: days[0]!, to: days[6]! };
  }
  // List shares the month's range, so its arrows step a month like the
  // calendar's and past events are browsable in both (§3.1).
  const cells = monthGrid(iso);
  return view === 'month'
    ? { from: cells[0]!.iso, to: cells[cells.length - 1]!.iso }
    : { from: startOfMonth(iso), to: endOfMonth(iso) };
}

/** Which way the back and forward arrows step, per view (§3.1). */
export function shiftPeriod(view: CalendarView, iso: string, direction: -1 | 1): string {
  if (view === 'day') return addDays(iso, direction);
  if (view === 'week') return addDays(iso, 7 * direction);
  return addMonths(iso, direction);
}

/**
 * Weekday and month abbreviations are spelled out rather than taken from
 * Intl. en-GB renders September as "Sept" from CLDR 42 onwards, so the
 * formatter's output moves with the Node build; the wireframe says "Sep",
 * and a date column is not something that should change under an upgrade.
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
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "Fri 18 Sep" — the list's date column and the week column headers. */
export function formatDayShort(iso: string): string {
  const date = toUtc(iso);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "Fri 18 Sep 2026". */
export function formatDayLong(iso: string): string {
  return `${formatDayShort(iso)} ${iso.slice(0, 4)}`;
}

/** The label between the arrows: month, week span, or single day (§3.1). */
export function periodLabel(view: CalendarView, iso: string): string {
  if (view === 'day') return formatDayLong(iso);
  if (view === 'week') {
    const days = weekDays(iso);
    return `${formatDayShort(days[0]!)} – ${formatDayLong(days[6]!)}`;
  }
  return `${MONTHS_LONG[toUtc(iso).getUTCMonth()]} ${iso.slice(0, 4)}`;
}
