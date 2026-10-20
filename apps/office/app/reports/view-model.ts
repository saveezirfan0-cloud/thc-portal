/**
 * /reports — the parts of §9.9 that are decisions about the SCREEN, not the
 * money: which week a tab opens on, when "Forecast for the period" shows,
 * how a send status reads, how a figure is written. Pure, so
 * `__tests__/view-model.test.ts` can hold every one of them.
 *
 * The money itself is not here. Every figure on the screen arrives priced
 * from `20260923130000_reports_and_finance_send.sql`; this file formats.
 */

import { type TimeFormat, UK_ZONE, clockLabel } from '@thc/domain';

export type ReportTab = 'financial' | 'payroll' | 'newstarter' | 'invoicing';
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
    tabParam === 'payroll' || tabParam === 'newstarter' || tabParam === 'invoicing'
      ? tabParam
      : 'financial';
  const byParam = first(params.by);
  const by: FinanceBy = byParam === 'client' || byParam === 'role' ? byParam : 'day';

  // Payroll and invoicing both look back: last week is exported Monday and
  // invoiced by Tuesday evening (§9.9, 28.07.2026).
  const fallback = tab === 'payroll' || tab === 'invoicing' ? lastWeek(today) : thisWeek(today);
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
// Ready to invoice (ADR-0172)
// ---------------------------------------------------------------------------

/**
 * `invoice_events`' ladder, in its order: the first step an event fails is
 * its status (20261021150000; `invoiced` since ADR-0175, 20261022100000).
 */
export type InvoiceStatus = 'open' | 'missing' | 'review' | 'ready' | 'invoiced';

export const INVOICE_STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  open: 'Check-out open',
  missing: 'Missing check-out',
  review: 'Needs review',
  ready: 'Ready to invoice',
  invoiced: 'Invoiced',
};

/** Green only when it may be invoiced; coral when a manager must act first. */
export const INVOICE_STATUS_TONE: Readonly<
  Record<InvoiceStatus, 'neutral' | 'amber' | 'coral' | 'green'>
> = {
  open: 'neutral',
  missing: 'coral',
  review: 'amber',
  ready: 'green',
  invoiced: 'green',
};

/** What the manager does next, one line per status. */
export const INVOICE_STATUS_HINT: Readonly<Record<InvoiceStatus, string>> = {
  open: 'Workers can still check out until 4 hours after the last shift ends.',
  missing:
    'A worker’s hours are not settled: resolve their No check-out on the Check-in screen with the actual finish time, or correct their check-in/out.',
  review: 'Review the violations and the lines below, then mark the event reviewed for invoicing.',
  ready: 'Ready: the invoice goes out with the completed timesheet at the time shown.',
  invoiced: 'Invoiced: the invoice is final. It is emailed with the completed timesheet.',
};

export function invoiceStatus(value: string): InvoiceStatus {
  return value === 'open' ||
    value === 'missing' ||
    value === 'review' ||
    value === 'ready' ||
    value === 'invoiced'
    ? value
    : 'review';
}

/**
 * Why a ready event's invoice has not gone yet, or when it will — from
 * `_invoice_groups`' verdict (ADR-0175). Null when there is nothing to say.
 */
export function invoiceSendNote(
  verdict: string | null,
  sendsAt: string | null,
  format?: TimeFormat,
): string | null {
  switch (verdict) {
    case 'scheduled':
    case 'due':
      return sendsAt
        ? `Invoice sends ${formatUkStamp(sendsAt, format)} UK`
        : 'Invoice sends shortly';
    case 'waiting':
      return 'Waits for the other events on this PO';
    case 'review':
      return 'Waits for another event on this PO to be reviewed';
    case 'missing':
      return 'Waits for a missing check-out on this PO';
    case 'no_recipients':
      return 'No email to send it to: add one on the client card';
    case 'disabled':
      return 'Invoices are switched off in Settings';
    case 'nothing_to_invoice':
      return 'Nothing to charge';
    default:
      return null;
  }
}

/**
 * A ready event the system will never invoice: dated before invoicing went
 * live (or on no PO group at all), so it is invoiced from the CSV as before.
 */
export const NOT_SYSTEM_INVOICED_NOTE = 'Not invoiced by the system: invoice it from the CSV';

/** A ready event's line under its status: when it sends, why not, or that it never will. */
export function readyEventNote(
  verdict: string | null,
  sendsAt: string | null,
  format?: TimeFormat,
): string | null {
  return verdict ? invoiceSendNote(verdict, sendsAt, format) : NOT_SYSTEM_INVOICED_NOTE;
}

export interface InvoiceEmailFacts {
  invoice_status?: string | null;
  invoice_attempts?: number | null;
  invoice_last_error?: string | null;
  invoice_queued_at?: string | null;
  email_sent_at?: string | null;
  email_failed_at?: string | null;
  email_error?: string | null;
}

/** The invoice gives up on drawing after this many started attempts (`invoices_unfinished`). */
export const INVOICE_MAX_ATTEMPTS = 24;

/**
 * Where an issued invoice's email is (ADR-0175), from the invoice row and
 * its INV1 outbox row. `resendable`: the office may "Send again" — the last
 * email is settled (sent or failed) and the files exist.
 */
export function invoiceEmailState(
  f: InvoiceEmailFacts,
  format?: TimeFormat,
): { tone: 'green' | 'amber' | 'coral' | 'neutral'; text: string; resendable: boolean } {
  if (f.invoice_status !== 'queued') {
    const attempts = f.invoice_attempts ?? 0;
    if (attempts >= INVOICE_MAX_ATTEMPTS) {
      return {
        tone: 'coral',
        text: `Could not be prepared after ${attempts} attempts${f.invoice_last_error ? `: ${f.invoice_last_error}` : ''}. Ask for it to be looked at.`,
        resendable: false,
      };
    }
    return {
      tone: f.invoice_status === 'failed' ? 'amber' : 'neutral',
      text:
        f.invoice_status === 'failed'
          ? `Being prepared; the last try failed${f.invoice_last_error ? ` (${f.invoice_last_error})` : ''} and is retried every 15 minutes`
          : 'Being prepared; it is emailed within 15 minutes',
      resendable: false,
    };
  }
  if (f.email_failed_at) {
    return {
      tone: 'coral',
      text: `Email failed ${formatUkStamp(f.email_failed_at, format)} UK${f.email_error ? `: ${f.email_error}` : ''}`,
      resendable: true,
    };
  }
  if (f.email_sent_at) {
    return {
      tone: 'green',
      text: `Emailed ${formatUkStamp(f.email_sent_at, format)} UK`,
      resendable: true,
    };
  }
  return { tone: 'neutral', text: 'Email queued; it goes within a few minutes', resendable: false };
}

/** Whether an invoiced event's live figure has moved away from what was invoiced. */
export function invoicedAmountChanged(
  live: number | string | null | undefined,
  invoiced: number | string | null | undefined,
): boolean {
  if (invoiced === null || invoiced === undefined) return false;
  return Math.round(Number(live ?? 0) * 100) !== Math.round(Number(invoiced) * 100);
}

/** The stored invoice PDF (ADR-0175). */
export function invoicePdfHref(invoiceId: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceId)}`;
}

/** `/reports/invoicing/:eventId`. */
export function invoiceEventHref(eventId: string): string {
  return `/reports/invoicing/${encodeURIComponent(eventId)}`;
}

/** The CSV of one ready event. */
export function invoiceEventExportHref(eventId: string, eventDate: string): string {
  const q = new URLSearchParams({
    report: 'invoicing',
    from: eventDate,
    to: eventDate,
    event: eventId,
  });
  return `/reports/export?${q.toString()}`;
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

/**
 * "Mon 15 Sep, 09:00" in UK time — a send stamp is an audit stamp (§1.8);
 * "Mon 15 Sep, 9:00 am" on the 12-hour clock (ADR-0085).
 */
export function formatUkStamp(instant: string, format?: TimeFormat): string {
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
  return `${WEEKDAYS[weekdayIndex(iso)]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}, ${clockLabel(`${parts.hour}:${parts.minute}`, format)}`;
}

/**
 * Exactly the scope's three strings, plus the one state the scope did not
 * need to name: queued, i.e. the job ran and the email is waiting for the
 * mail sender (P2). Showing that as "Last sent" would be a lie.
 */
export function sendStatus(
  send: ReportSend | null,
  format?: TimeFormat,
): { tone: SendTone; text: string } {
  if (!send) return { tone: 'none', text: 'Not sent yet' };
  switch (send.status) {
    case 'sent':
      return {
        tone: 'ok',
        text: `Last sent: ${send.sent_at ? formatUkStamp(send.sent_at, format) : '—'}`,
      };
    case 'failed':
      return { tone: 'fail', text: 'Failed to send report' };
    case 'no_new':
      return {
        tone: 'none',
        text: `No new: ${formatUkStamp(send.sent_at ?? send.created_at ?? new Date().toISOString(), format)}`,
      };
    default:
      return {
        tone: 'queued',
        text: `Queued: ${send.created_at ? formatUkStamp(send.created_at, format) : '—'} · waiting for the mail sender`,
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

/**
 * "40-••-•• · ••••3310" — the preview masks bank details as the staff profile
 * does (first pair of the sort code, last four of the account); the CSV
 * carries them in full (ADR-0130).
 */
export function maskBank(sortCode: string | null, account: string | null): string | null {
  const sort = sortCode?.replace(/[^0-9]/g, '') ?? '';
  const acct = account?.replace(/[^0-9]/g, '') ?? '';
  if (!sort && !acct) return null;
  const parts = [sort ? `${sort.slice(0, 2)}-••-••` : null, acct ? `••••${acct.slice(-4)}` : null];
  return parts.filter(Boolean).join(' · ');
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
