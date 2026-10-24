/**
 * /invoices — the decisions about the SCREEN (ADR-0210): which filters the
 * URL carries, what the status and Xero chips mean, the KPI strip and the
 * weekly / monthly summaries. Pure, so `__tests__/view-model.test.ts` holds
 * every one of them.
 *
 * The money is the database's (`invoices.net / vat / total`, rounded per
 * line at issue); this file only adds the rows up, in whole pence so a
 * thousand invoices never drift.
 */

import { MONTHS_LONG, fromPence, hoursFromMin, num, pence, shortDay } from './format';
import type {
  InvoiceListRow,
  InvoiceSource,
  InvoiceStatus,
  RawInvoiceListRow,
  XeroStatus,
} from './types';

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: string | undefined | null): string | null {
  if (!value || !ISO.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday (RULE-06: the platform's weeks are Monday-first). */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** The ISO-8601 year and week number of a date (the week's Thursday decides the year). */
export function isoWeek(iso: string): { year: number; week: number } {
  const thursday = addDays(weekStart(iso), 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const week =
    Math.floor(
      (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${jan1}T00:00:00Z`)) / 86_400_000 / 7,
    ) + 1;
  return { year, week };
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// the URL
// ---------------------------------------------------------------------------

export type InvoiceTab = 'all' | 'weekly' | 'monthly';
export type QuickRange =
  'this-week' | 'last-week' | 'this-month' | 'last-month' | 'quarter' | 'all';
export type StatusGroup = 'draft' | 'sent' | 'void';
export type XeroFilter = '' | 'pending' | 'synced' | 'mismatch' | 'failed';
export type SortKey = 'number' | 'date' | 'client' | 'total';

export interface InvoiceView {
  tab: InvoiceTab;
  client: string;
  from: string | null;
  to: string | null;
  /** The quick range that produced `from` / `to`, when one did. */
  range: QuickRange | 'custom';
  q: string;
  /** Draft / Generated and Sent are on by default; Void is off. */
  statuses: StatusGroup[];
  source: '' | InvoiceSource;
  xero: XeroFilter;
  sort: SortKey;
  dir: 'asc' | 'desc';
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const PAGE_SIZE = 50;
export const DEFAULT_STATUSES: readonly StatusGroup[] = ['draft', 'sent'];
export const STATUS_GROUPS: readonly StatusGroup[] = ['draft', 'sent', 'void'];
export const STATUS_GROUP_LABEL: Readonly<Record<StatusGroup, string>> = {
  draft: 'Draft / Generated',
  sent: 'Sent',
  void: 'Void',
};

export const QUICK_RANGES: readonly { value: QuickRange; label: string }[] = [
  { value: 'this-week', label: 'This Week' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'all', label: 'All' },
];

/** The dates a quick range stands for, in UK dates; `All` is open on both ends. */
export function quickRange(
  range: QuickRange,
  today: string,
): { from: string | null; to: string | null } {
  switch (range) {
    case 'this-week': {
      const from = weekStart(today);
      return { from, to: addDays(from, 6) };
    }
    case 'last-week': {
      const from = addDays(weekStart(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case 'this-month':
      return { from: monthStart(today), to: monthEnd(today) };
    case 'last-month': {
      const lastDay = addDays(monthStart(today), -1);
      return { from: monthStart(lastDay), to: lastDay };
    }
    case 'quarter': {
      // The calendar quarter that holds today (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec).
      const month = Number(today.slice(5, 7));
      const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const from = `${today.slice(0, 4)}-${String(startMonth).padStart(2, '0')}-01`;
      const toMonth = `${today.slice(0, 4)}-${String(startMonth + 2).padStart(2, '0')}-01`;
      return { from, to: monthEnd(toMonth) };
    }
    case 'all':
      return { from: null, to: null };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XERO_FILTERS: readonly XeroFilter[] = ['pending', 'synced', 'mismatch', 'failed'];
const SORTS: readonly SortKey[] = ['number', 'date', 'client', 'total'];

export function parseInvoiceView(params: Params, today: string): InvoiceView {
  const tabParam = first(params['tab']);
  const tab: InvoiceTab = tabParam === 'weekly' || tabParam === 'monthly' ? tabParam : 'all';

  const rangeParam = first(params['range']);
  const named = QUICK_RANGES.find((r) => r.value === rangeParam)?.value;
  let from = isoDate(first(params['from']));
  let to = isoDate(first(params['to']));
  let range: InvoiceView['range'] = 'all';
  if (named && named !== 'all') {
    ({ from, to } = quickRange(named, today));
    range = named;
  } else if (from || to) {
    range = 'custom';
  }
  if (from && to && from > to) [from, to] = [to, from];

  // `status` is a comma list (our links) or repeated checkboxes (the filter form);
  // absent means the defaults, `none` means nothing is ticked, and a submitted
  // form (`f`) with no box ticked means nothing is ticked too.
  const rawStatus = params['status'];
  const statusParts =
    rawStatus === undefined
      ? null
      : (Array.isArray(rawStatus) ? rawStatus : [rawStatus]).flatMap((p) => p.split(','));
  const statuses: StatusGroup[] =
    statusParts === null
      ? params['f'] !== undefined
        ? []
        : [...DEFAULT_STATUSES]
      : STATUS_GROUPS.filter((g) => statusParts.includes(g));

  const source = first(params['source']);
  const xero = first(params['xero']) as XeroFilter | undefined;
  const sort = first(params['sort']) as SortKey | undefined;
  const clientParam = first(params['client']) ?? '';
  const page = Number.parseInt(first(params['page']) ?? '1', 10);

  return {
    tab,
    client: UUID.test(clientParam) ? clientParam : '',
    from,
    to,
    range,
    q: (first(params['q']) ?? '').trim().slice(0, 100),
    statuses,
    source: source === 'events' || source === 'timesheet' ? source : '',
    xero: xero && XERO_FILTERS.includes(xero) ? xero : '',
    sort: sort && SORTS.includes(sort) ? sort : 'number',
    dir: first(params['dir']) === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** The query string that reproduces a view (defaults are left out). */
export function viewQuery(view: InvoiceView, patch: Partial<InvoiceView> = {}): string {
  const next = { ...view, ...patch };
  const q = new URLSearchParams();
  if (next.tab !== 'all') q.set('tab', next.tab);
  if (next.client) q.set('client', next.client);
  if (next.range !== 'all' && next.range !== 'custom') q.set('range', next.range);
  else {
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
  }
  if (next.q) q.set('q', next.q);
  const isDefault =
    next.statuses.length === DEFAULT_STATUSES.length &&
    DEFAULT_STATUSES.every((s) => next.statuses.includes(s));
  if (!isDefault) q.set('status', next.statuses.length === 0 ? 'none' : next.statuses.join(','));
  if (next.source) q.set('source', next.source);
  if (next.xero) q.set('xero', next.xero);
  if (next.sort !== 'number') q.set('sort', next.sort);
  if (next.dir !== 'desc') q.set('dir', next.dir);
  if (next.page > 1) q.set('page', String(next.page));
  const text = q.toString();
  return text ? `?${text}` : '';
}

export function listHref(view: InvoiceView, patch: Partial<InvoiceView> = {}): string {
  return `/invoices${viewQuery(view, patch)}`;
}

export function exportHref(view: InvoiceView): string {
  return `/invoices/export${viewQuery({ ...view, page: 1, tab: 'all' })}`;
}

export function invoiceHref(id: string): string {
  return `/invoices/${encodeURIComponent(id)}`;
}
export function pdfHref(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}`;
}
export function excelHref(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}/excel`;
}
export function jobHref(jobId: string): string {
  return `/invoices/process/${encodeURIComponent(jobId)}`;
}

// ---------------------------------------------------------------------------
// statuses
// ---------------------------------------------------------------------------

/** Pill tones the design system draws. */
export type Tone = 'neutral' | 'cyan' | 'green' | 'amber' | 'coral' | 'purple';

export const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  drawing: 'Drawing',
  failed: 'Failed',
  generated: 'Generated',
  queued: 'Sent',
  void: 'Void',
};

export const STATUS_TONE: Readonly<Record<InvoiceStatus, Tone>> = {
  drawing: 'amber',
  failed: 'coral',
  generated: 'cyan',
  queued: 'green',
  void: 'neutral',
};

/** Which chip a status belongs to. */
export function statusGroup(status: InvoiceStatus): StatusGroup {
  if (status === 'queued') return 'sent';
  if (status === 'void') return 'void';
  return 'draft';
}

/** The database statuses a set of chips stands for (the coarse filter the read applies). */
export function statusesFor(groups: readonly StatusGroup[]): InvoiceStatus[] {
  const out: InvoiceStatus[] = [];
  if (groups.includes('draft')) out.push('drawing', 'failed', 'generated');
  if (groups.includes('sent')) out.push('queued');
  if (groups.includes('void')) out.push('void');
  return out;
}

export const XERO_LABEL: Readonly<Record<XeroStatus, string>> = {
  pending: 'Xero pending',
  syncing: 'Xero pending',
  synced: 'In Xero',
  mismatch: 'Xero mismatch',
  failed: 'Xero failed',
  skipped: 'Not sent to Xero',
};

export const XERO_TONE: Readonly<Record<XeroStatus, Tone>> = {
  pending: 'amber',
  syncing: 'amber',
  synced: 'green',
  mismatch: 'coral',
  failed: 'coral',
  skipped: 'neutral',
};

export const XERO_FILTER_LABEL: Readonly<Record<Exclude<XeroFilter, ''>, string>> = {
  pending: 'Pending',
  synced: 'Synced',
  mismatch: 'Mismatch',
  failed: 'Failed',
};

/** The Xero filter a row falls under (`syncing` reads as pending; `skipped` has none). */
export function xeroGroup(xero: XeroStatus | null): XeroFilter {
  if (xero === 'syncing') return 'pending';
  if (xero === 'skipped' || xero === null) return '';
  return xero;
}

export const SOURCE_LABEL: Readonly<Record<InvoiceSource, string>> = {
  events: 'Events',
  timesheet: 'Timesheet',
};

export const FORMAT_LABEL: Readonly<Record<InvoiceListRow['format'], string>> = {
  named: 'Named',
  aggregated: 'Aggregated',
  log: 'Sign-in log',
};

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** The raw PostgREST row, as the screen reads it. */
export function toListRow(raw: RawInvoiceListRow): InvoiceListRow {
  const client = one(raw.clients);
  const xero = one(raw.xero_sync);
  const eventVenues = [
    ...new Set(
      (raw.invoice_event_links ?? [])
        .map((link) => one(link.events)?.venue_name?.trim() ?? '')
        .filter((venue) => venue !== ''),
    ),
  ];
  const billTo = raw.bill_to ?? {};
  const venue = raw.source === 'timesheet' ? (billTo.venue ?? '').trim() : eventVenues.join(' · ');
  const format: InvoiceListRow['format'] =
    raw.source === 'timesheet' ? (billTo.format === 'aggregated' ? 'aggregated' : 'named') : 'log';
  return {
    id: raw.id,
    number: raw.number,
    invoiceDate: raw.invoice_date,
    clientId: raw.client_id,
    clientName: (raw.source === 'timesheet' ? billTo.name : null) || client?.name || '—',
    venue,
    poNumber: raw.po_number?.trim() ? raw.po_number.trim() : null,
    source: raw.source,
    format,
    status: raw.status,
    payableMin: num(raw.payable_min),
    net: num(raw.net),
    vat: num(raw.vat),
    total: num(raw.total),
    lastSentAt: raw.sent_at ?? raw.queued_at ?? null,
    xero: xero?.status ?? null,
    xeroInvoiceId: xero?.xero_invoice_id ?? null,
  };
}

/** "# / client / PO" search: every word must be in one of the three. */
export function matchesSearch(row: InvoiceListRow, q: string): boolean {
  const words = q.toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${row.number} ${row.clientName} ${row.poNumber ?? ''}`.toLowerCase();
  return words.every((word) => hay.includes(word.replace(/^#/, '')));
}

/** Every filter, applied in memory (the read applies the coarse ones; this is the whole rule). */
export function filterRows(rows: readonly InvoiceListRow[], view: InvoiceView): InvoiceListRow[] {
  return rows.filter((row) => {
    if (view.client && row.clientId !== view.client) return false;
    if (view.from && row.invoiceDate < view.from) return false;
    if (view.to && row.invoiceDate > view.to) return false;
    if (!view.statuses.includes(statusGroup(row.status))) return false;
    if (view.source && row.source !== view.source) return false;
    if (view.xero && xeroGroup(row.xero) !== view.xero) return false;
    return matchesSearch(row, view.q);
  });
}

export function sortRows(rows: readonly InvoiceListRow[], view: InvoiceView): InvoiceListRow[] {
  const sign = view.dir === 'asc' ? 1 : -1;
  const key = (row: InvoiceListRow): string | number =>
    view.sort === 'date'
      ? row.invoiceDate
      : view.sort === 'client'
        ? row.clientName.toLowerCase()
        : view.sort === 'total'
          ? row.total
          : row.number;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
    // Ties fall back to the number, so a page boundary never repeats or skips a row.
    return cmp !== 0 ? cmp * sign : (a.number - b.number) * sign;
  });
}

export function paginate<T>(
  rows: readonly T[],
  page: number,
  size = PAGE_SIZE,
): {
  rows: T[];
  page: number;
  pages: number;
  total: number;
} {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((at - 1) * size, at * size), page: at, pages, total: rows.length };
}

// ---------------------------------------------------------------------------
// KPIs and summaries
// ---------------------------------------------------------------------------

export interface Totals {
  count: number;
  hours: number;
  total: number;
  average: number;
}

/** Invoices · total (amount due) · hours · average. */
export function totalsOf(rows: readonly InvoiceListRow[]): Totals {
  const totalPence = rows.reduce((sum, r) => sum + pence(r.total), 0);
  const minutes = rows.reduce((sum, r) => sum + r.payableMin, 0);
  return {
    count: rows.length,
    hours: hoursFromMin(minutes),
    total: fromPence(totalPence),
    average: rows.length === 0 ? 0 : fromPence(Math.round(totalPence / rows.length)),
  };
}

export interface SummaryGroup extends Totals {
  key: string;
  label: string;
  rows: InvoiceListRow[];
}

function summarise(
  rows: readonly InvoiceListRow[],
  keyOf: (row: InvoiceListRow) => { key: string; label: string },
): SummaryGroup[] {
  const groups = new Map<string, SummaryGroup>();
  for (const row of rows) {
    const { key, label } = keyOf(row);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, rows: [], count: 0, hours: 0, total: 0, average: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, ...totalsOf(group.rows) }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** One group per ISO week of the invoice date, newest first: "Week 43: 19 Oct – 25 Oct 2026". */
export function weeklySummary(rows: readonly InvoiceListRow[]): SummaryGroup[] {
  return summarise(rows, (row) => {
    const { year, week } = isoWeek(row.invoiceDate);
    const monday = weekStart(row.invoiceDate);
    const sunday = addDays(monday, 6);
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      label: `Week ${week}: ${shortDay(monday)} – ${shortDay(sunday)} ${sunday.slice(0, 4)}`,
    };
  });
}

/** One group per month of the invoice date, newest first: "October 2026". */
export function monthlySummary(rows: readonly InvoiceListRow[]): SummaryGroup[] {
  return summarise(rows, (row) => ({
    key: row.invoiceDate.slice(0, 7),
    label: `${MONTHS_LONG[Number(row.invoiceDate.slice(5, 7)) - 1] ?? ''} ${row.invoiceDate.slice(0, 4)}`,
  }));
}

// ---------------------------------------------------------------------------
// the detail page
// ---------------------------------------------------------------------------

/** Where an invoice stands in the Void / Email / Re-draw buttons. */
export function invoiceCan(
  status: InvoiceStatus,
  source: InvoiceSource,
): { void: boolean; email: boolean; redraw: boolean; files: boolean } {
  return {
    void: status === 'generated' || status === 'queued',
    email: source === 'timesheet' && (status === 'generated' || status === 'queued'),
    redraw: source === 'timesheet' && (status === 'drawing' || status === 'failed'),
    files: status === 'generated' || status === 'queued' || status === 'void',
  };
}

/** A Xero row that can be retried by the office (`xero_retry`). */
export function xeroRetryable(xero: XeroStatus | null | undefined): boolean {
  return xero === 'failed' || xero === 'mismatch';
}

/** The voided invoice's Xero warning, said once for the modal and the timeline. */
export function voidXeroNote(xero: XeroStatus | null | undefined): string | null {
  return xero === 'synced' || xero === 'mismatch'
    ? 'This invoice is already in Xero. Voiding it here does not void it there: void it in Xero too.'
    : null;
}
