/**
 * /reports — the parts of §9.9 that are decisions about the SCREEN, not the
 * money: which week a tab opens on, when "Forecast for the period" shows,
 * how a send status reads, how a figure is written. Pure, so
 * `__tests__/view-model.test.ts` can hold every one of them.
 *
 * The money itself is not here. Every figure on the screen arrives priced
 * from `20260923130000_reports_and_finance_send.sql`; this file formats.
 */

import { UK_ZONE } from '@thc/domain';

export type ReportTab = 'financial' | 'payroll' | 'newstarter';
export type FinanceBy = 'day' | 'client' | 'role';

export interface ReportView {
  tab: ReportTab;
  /** Financial and Payroll: an inclusive Mon–Sun-ish range, ISO dates. */
  from: string;
  to: string;
  by: FinanceBy;
  /** New Starter: the picked date; the report covers the week before its week. */
  date: string;
}

type Params = Record<string, string | string[] | undefined>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isoDate(value: string | undefined): string | null {
  if (!value || !ISO.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

/** Today in Europe/London, `YYYY-MM-DD`. */
export function todayInUk(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: UK_ZONE }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. The platform's weeks are Monday-first (RULE-06). */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** "This week" (Financial default). */
export function thisWeek(today: string): { from: string; to: string } {
  const from = weekStart(today);
  return { from, to: addDays(from, 6) };
}

/** "Last week" — "sets Mon–Sun of the previous week itself" (Payroll default). */
export function lastWeek(today: string): { from: string; to: string } {
  const from = addDays(weekStart(today), -7);
  return { from, to: addDays(from, 6) };
}

/** The New Starter period for a picked date: the Mon–Sun week before its week. */
export function newStarterPeriod(date: string): { from: string; to: string } {
  const from = addDays(weekStart(date), -7);
  return { from, to: addDays(from, 6) };
}

/** No report spans more than a year: one request, one bounded query. */
const MAX_RANGE_DAYS = 366;

export function parseReportView(params: Params, today: string): ReportView {
  const tabParam = first(params.tab);
  const tab: ReportTab =
    tabParam === 'payroll' || tabParam === 'newstarter' ? tabParam : 'financial';
  const byParam = first(params.by);
  const by: FinanceBy = byParam === 'client' || byParam === 'role' ? byParam : 'day';

  const fallback = tab === 'payroll' ? lastWeek(today) : thisWeek(today);
  let from = isoDate(first(params.from)) ?? fallback.from;
  let to = isoDate(first(params.to)) ?? fallback.to;
  if (from > to) [from, to] = [to, from];
  if (addDays(from, MAX_RANGE_DAYS) < to) to = addDays(from, MAX_RANGE_DAYS);

  return { tab, from, to, by, date: isoDate(first(params.date)) ?? today };
}

/** `/reports?tab=…` with the view's own parameters and any overrides. */
export function reportHref(view: ReportView, patch: Partial<ReportView> = {}): string {
  const next = { ...view, ...patch };
  const q = new URLSearchParams({ tab: next.tab });
  if (next.tab === 'newstarter') {
    q.set('date', next.date);
  } else {
    q.set('from', next.from);
    q.set('to', next.to);
    if (next.tab === 'financial') q.set('by', next.by);
  }
  return `/reports?${q.toString()}`;
}

export function exportHref(view: ReportView): string {
  const q = new URLSearchParams({ report: view.tab });
  if (view.tab === 'newstarter') q.set('date', view.date);
  else {
    q.set('from', view.from);
    q.set('to', view.to);
    if (view.tab === 'financial') q.set('by', view.by);
  }
  return `/reports/export?${q.toString()}`;
}

/**
 * §9.9: "The 'Forecast for the period' label is shown for the current week
 * and continues to show for the immediately preceding week through Tuesday.
 * It disappears starting Wednesday morning for that previous week" —
 * payroll is exported Monday, invoicing done by Tuesday evening. A future
 * week is a forecast by definition.
 */
export function showForecastLabel(from: string, to: string, today: string): boolean {
  const current = weekStart(today);
  if (to >= current) return true;
  const previous = addDays(current, -7);
  const mondayOrTuesday = weekdayIndex(today) <= 1;
  return mondayOrTuesday && to >= previous && from <= addDays(previous, 6);
}

// ---------------------------------------------------------------------------
// Send status (§9.9, confirmed 28.07.2026)
// ---------------------------------------------------------------------------

export interface ReportSend {
  id: number;
  kind: 'payroll' | 'new_starter';
  period_start: string;
  period_end: string;
  status: 'preparing' | 'queued' | 'sent' | 'failed' | 'no_new';
  sent_at: string | null;
  created_at: string | null;
  row_count: number | null;
  held_count: number | null;
  error: string | null;
}

export type SendTone = 'ok' | 'none' | 'fail' | 'queued';

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

/** "Mon 15 Sep, 09:00" in UK time — a send stamp is an audit stamp (§1.8). */
export function formatUkStamp(instant: string): string {
  const at = new Date(instant);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: UK_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}, ${parts.hour}:${parts.minute}`;
}

/**
 * Exactly the scope's three strings, plus the one state the scope did not
 * need to name: queued, i.e. the job ran and the email is waiting for the
 * mail sender (P2). Showing that as "Last sent" would be a lie.
 */
export function sendStatus(send: ReportSend | null): { tone: SendTone; text: string } {
  if (!send) return { tone: 'none', text: 'Not sent yet' };
  switch (send.status) {
    case 'sent':
      return { tone: 'ok', text: `Last sent: ${send.sent_at ? formatUkStamp(send.sent_at) : '—'}` };
    case 'failed':
      return { tone: 'fail', text: 'Failed to send report' };
    case 'no_new':
      return {
        tone: 'none',
        text: `No new: ${formatUkStamp(send.sent_at ?? send.created_at ?? new Date().toISOString())}`,
      };
    default:
      return {
        tone: 'queued',
        text: `Queued: ${send.created_at ? formatUkStamp(send.created_at) : '—'} · waiting for the mail sender`,
      };
  }
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** PostgREST may return `numeric` as a string; parse explicitly, never add. */
export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  return typeof value === 'number' ? value : Number(value);
}

const POUNDS2 = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});
const POUNDS0 = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

/** "£1,072.69". */
export function pounds(value: number | string | null | undefined): string {
  return POUNDS2.format(num(value));
}

/** "£31,406" — the KPI tiles, whole pounds as the wireframe draws them. */
export function poundsWhole(value: number | string | null | undefined): string {
  return POUNDS0.format(num(value));
}

/** "28.33" from minutes. */
export function hours(minutes: number | null | undefined): string {
  return ((minutes ?? 0) / 60).toFixed(2);
}

/** "1,864.0" — hours in a KPI tile. */
export function hoursKpi(minutes: number | null | undefined): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format((minutes ?? 0) / 60);
}

export function breakLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "●●●●●●●1A" — §9.9's preview masks the NI number; the CSV carries it in full. */
export function maskNi(ni: string | null): string | null {
  if (!ni) return null;
  const clean = ni.replace(/\s+/g, '');
  return `${'●'.repeat(Math.max(clean.length - 2, 0))}${clean.slice(-2)}`;
}

/** "Mon 8 – Sun 14 Sep" for a period. */
export function periodLabel(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const head =
    a.getUTCMonth() === b.getUTCMonth()
      ? `${WEEKDAYS[weekdayIndex(from)]} ${a.getUTCDate()}`
      : `${WEEKDAYS[weekdayIndex(from)]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  return `${head} – ${WEEKDAYS[weekdayIndex(to)]} ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}

/** "Mon 08 Sep" for a shift date. */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

/** "21.11.2003" — the New Starter preview's date form. */
export function dottedDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function employeeId(id: number | null): string {
  return id === null ? '—' : `THC-${String(id).padStart(5, '0')}`;
}
