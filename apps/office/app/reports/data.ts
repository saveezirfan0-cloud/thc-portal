import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { DEFAULT_ROW_CEILING, readAllPages } from '@thc/db/paged';
import type { PageReply, ReadAllResult } from '@thc/db/paged';
import type { FinancialCsvRow, InvoiceCsvRow, NewStarterCsvRow, PayrollCsvRow } from '@thc/pdf';
import type { ReportSend, ReportView } from './view-model';
import { readProblem } from '../_lib/dbError';

/**
 * Reads for /reports — Scope §9.9.
 *
 * Every figure comes back priced from
 * `20260923130000_reports_and_finance_send.sql`: payable time from
 * payable_shifts_v (RULE-01/02/14/15), base and holiday +12.07% in separate
 * columns, pending shifts with no figure at all. This file adds nothing up.
 *
 * The functions are security definer and raise `admins_only` for anybody
 * else, so a non-admin session reaches an error here, not an empty report.
 */

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** What one report RPC call resolves to. */
export interface RpcReply {
  data: unknown;
  error: { code?: string | null; message: string; details?: string | null } | null;
  count?: number | null;
}

/**
 * A report RPC call before it is awaited. PostgREST orders and ranges a
 * set-returning function like a table, which is how the reads below page
 * past `max_rows` (1000).
 */
export interface RpcQuery extends PromiseLike<RpcReply> {
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): RpcQuery;
  range(from: number, to: number): RpcQuery;
}

type RpcOptions = { count?: 'exact' };

/**
 * `packages/db`'s generated types predate these functions (their `Functions`
 * map is the Phase 0 placeholder), so the RPCs are typed here by name.
 * Regenerating with `pnpm --filter @thc/db gen:types` makes this redundant.
 */
export interface ReportsRpc {
  rpc(
    fn: 'payroll_report' | 'payroll_report_people',
    args: { p_from: string; p_to: string },
    options?: RpcOptions,
  ): RpcQuery;
  rpc(
    fn: 'finance_report',
    args: { p_from: string; p_to: string; p_by: string },
    options?: RpcOptions,
  ): RpcQuery;
  rpc(fn: 'new_starter_report', args: { p_date: string }, options?: RpcOptions): RpcQuery;
  rpc(fn: 'retry_finance_report', args: { p_send: number }): RpcQuery;
  rpc(fn: 'invoice_events', args: { p_from: string; p_to: string }, options?: RpcOptions): RpcQuery;
  rpc(fn: 'invoice_event_lines' | 'invoice_event_violations', args: { p_event: string }): RpcQuery;
  rpc(
    fn: 'invoice_export_rows',
    args: { p_from: string; p_to: string; p_event: string | null },
    options?: RpcOptions,
  ): RpcQuery;
  rpc(
    fn: 'sign_off_event_invoice',
    args: { p_event: string; p_note: string; p_fingerprint: string },
  ): RpcQuery;
  from(table: 'report_sends'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): { limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };
      };
    };
  };
}

export async function reportsDb(): Promise<ReportsRpc> {
  return createClient(await cookies()) as unknown as ReportsRpc;
}

export interface PayrollLine extends PayrollCsvRow {
  booking_id: string;
  shift_id: string;
  staff_id: string;
  removed: boolean;
  status: 'settled' | 'pending';
  attempted_at: string | null;
  no_check_out_unresolved: boolean;
  late_check_in: boolean;
  early_check_out: boolean;
  worked_min: number | null;
  floor_applied: boolean;
  in_export: boolean;
  exported_at: string | null;
  exported_payable_min: number | null;
  exported_total: number | string | null;
  changed_since_export: boolean;
}

export interface PayrollPerson {
  staff_id: string | null;
  employee_id: number | null;
  staff_name: string | null;
  removed: boolean | null;
  is_total: boolean;
  workers: number;
  shifts: number;
  pending: number;
  turned_away: number;
  payable_min: number;
  break_min: number;
  base: number | string;
  holiday: number | string;
  total: number | string;
  changed_since_export: number;
}

export interface FinanceRow extends FinancialCsvRow {
  group_key: string | null;
  event_count: number;
  margin_pct: number | string | null;
}

export interface NewStarter extends NewStarterCsvRow {
  staff_id: string;
  removed: boolean;
  period_start: string;
  period_end: string;
}

// ---------------------------------------------------------------------
// The paged reads (go-live audit 17.10.2026, B1)
//
// PostgREST cuts every reply at max_rows (1000) without an error; a week of
// payroll at 10–15 events a day is 700–2,100 shift lines, and the lines it
// dropped were the surnames at the end of the alphabet. Every report read
// goes through readAllPages: a total order, the exact count asked for with
// the first page, and a refusal — never a short list — when the rows do not
// add up. The screen and the CSV call the same functions, so they agree.
// ---------------------------------------------------------------------

/** Enough for any week or month at full volume; a longer range is narrowed, never cut. */
export const SCREEN_ROW_CEILING = 25_000;
export const EXPORT_ROW_CEILING = DEFAULT_ROW_CEILING;

const exact = (first: boolean): RpcOptions | undefined => (first ? { count: 'exact' } : undefined);
const page = <T>(query: RpcQuery) => query as unknown as PromiseLike<PageReply<T>>;

/**
 * Every shift line, in payroll_report's own order — every sort key is one of
 * its columns — plus booking_id, so no two lines tie across a page boundary.
 */
export function readPayrollLines(
  db: ReportsRpc,
  from: string,
  to: string,
  ceiling: number = SCREEN_ROW_CEILING,
): Promise<ReadAllResult<PayrollLine>> {
  return readAllPages<PayrollLine>(
    (range) =>
      page(
        db
          .rpc('payroll_report', { p_from: from, p_to: to }, exact(range.first))
          .order('removed')
          .order('sort_surname', { ascending: true, nullsFirst: false })
          .order('staff_name')
          .order('staff_id')
          .order('starts_at')
          .order('booking_id')
          .range(range.from, range.to),
      ),
    { what: 'payroll lines', key: (row) => row.booking_id, ceiling },
  );
}

/**
 * One row per worker and the total. Its sort keys are not all columns, so it
 * is read in the function's own order, which ends on staff_id
 * (20261019190100) and so has no ties.
 */
export function readPayrollPeople(
  db: ReportsRpc,
  from: string,
  to: string,
  ceiling: number = SCREEN_ROW_CEILING,
): Promise<ReadAllResult<PayrollPerson>> {
  return readAllPages<PayrollPerson>(
    (range) =>
      page(
        db
          .rpc('payroll_report_people', { p_from: from, p_to: to }, exact(range.first))
          .range(range.from, range.to),
      ),
    {
      what: 'workers on the payroll',
      key: (row) => (row.is_total ? 'total' : `staff:${row.staff_id}`),
      ceiling,
    },
  );
}

/** One row per day, client or role, and the total — ordered by its unique group key. */
export function readFinance(
  db: ReportsRpc,
  from: string,
  to: string,
  by: string,
  ceiling: number = SCREEN_ROW_CEILING,
): Promise<ReadAllResult<FinanceRow>> {
  return readAllPages<FinanceRow>(
    (range) =>
      page(
        db
          .rpc('finance_report', { p_from: from, p_to: to, p_by: by }, exact(range.first))
          .range(range.from, range.to),
      ),
    {
      what: 'financial report rows',
      key: (row) => (row.is_total ? 'total' : `group:${row.group_key}`),
      ceiling,
    },
  );
}

/** One row per new starter, ordered by new_starter_rows (ending on employee_id). */
export function readNewStarters(
  db: ReportsRpc,
  date: string,
  ceiling: number = SCREEN_ROW_CEILING,
): Promise<ReadAllResult<NewStarter>> {
  return readAllPages<NewStarter>(
    (range) =>
      page(
        db
          .rpc('new_starter_report', { p_date: date }, exact(range.first))
          .range(range.from, range.to),
      ),
    { what: 'new starters', key: (row) => row.staff_id, ceiling },
  );
}

// ---------------------------------------------------------------------
// Ready to invoice (ADR-0171, 20261021150000)
// ---------------------------------------------------------------------

/** One event on the Invoicing tab, priced and judged by `invoice_events`. */
export interface InvoiceEvent {
  event_id: string;
  event_date: string;
  event_title: string;
  client_name: string;
  po_number: string | null;
  venue_name: string;
  cancelled: boolean;
  last_end_at: string | null;
  check_out_closes_at: string | null;
  shifts: number;
  billable_shifts: number;
  pending: number;
  no_shows: number;
  turned_away: number;
  payable_min: number;
  invoicing: number | string;
  violations: number;
  unresolved: number;
  /** Unresolved No check-outs, including a stale-fix one with a recorded finish (D15). */
  no_checkouts: number;
  status: string;
  fingerprint: string;
  signed_off_at: string | null;
  signed_off_by_name: string | null;
  signoff_note: string | null;
  signed_invoicing: number | string | null;
  signoff_stale: boolean;
}

/** One shift line of an event (`invoice_event_lines`). */
export interface InvoiceLine {
  booking_id: string;
  staff_name: string;
  employee_id: number | null;
  removed: boolean;
  role_name: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  check_in_at: string | null;
  check_out_at: string | null;
  kind: 'worked' | 'turned_away' | 'no_show' | 'cancelled_on_day';
  status: 'settled' | 'pending';
  late_check_in: boolean;
  early_check_out: boolean;
  no_check_out_unresolved: boolean;
  unpaid_break_min: number;
  payable_min: number | null;
  floor_applied: boolean;
  charge_rate: number | string;
  invoicing: number | string | null;
}

/** One violation on an event (`invoice_event_violations`). */
export interface InvoiceViolation {
  violation_id: string;
  booking_id: string;
  staff_name: string;
  employee_id: number | null;
  role_name: string;
  type: 'no_show' | 'late' | 'left_early' | 'left_geofence' | 'no_checkout';
  detected_at: string;
  minutes_late: number | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  actual_finish_at: string | null;
}

/** Every event dated in the range that has lines, in the function's order (unique by id). */
export function readInvoiceEvents(
  db: ReportsRpc,
  from: string,
  to: string,
  ceiling: number = SCREEN_ROW_CEILING,
): Promise<ReadAllResult<InvoiceEvent>> {
  return readAllPages<InvoiceEvent>(
    (range) =>
      page(
        db
          .rpc('invoice_events', { p_from: from, p_to: to }, exact(range.first))
          .range(range.from, range.to),
      ),
    { what: 'events to invoice', key: (row) => row.event_id, ceiling },
  );
}

/** The CSV rows: ready events only, in the function's order (ending on booking_id). */
export function readInvoiceExportRows(
  db: ReportsRpc,
  from: string,
  to: string,
  event: string | null,
  ceiling: number = EXPORT_ROW_CEILING,
): Promise<ReadAllResult<InvoiceCsvRow & { booking_id: string }>> {
  return readAllPages<InvoiceCsvRow & { booking_id: string }>(
    (range) =>
      page(
        db
          .rpc(
            'invoice_export_rows',
            { p_from: from, p_to: to, p_event: event },
            exact(range.first),
          )
          .range(range.from, range.to),
      ),
    { what: 'invoice lines', key: (row) => row.booking_id, ceiling },
  );
}

export interface InvoiceEventDetail {
  problem: string | null;
  event: InvoiceEvent | null;
  lines: InvoiceLine[];
  violations: InvoiceViolation[];
}

/**
 * One event for /reports/invoicing/:eventId. Its date is read first (an
 * office session reads `events` under its own policy), then the list's own
 * verdict for that day — the same function the tab and the sign-off ask,
 * so the three can never disagree.
 */
export async function loadInvoiceEvent(eventId: string): Promise<InvoiceEventDetail> {
  const empty: InvoiceEventDetail = { problem: null, event: null, lines: [], violations: [] };
  if (!supabaseConfigured()) return { ...empty, problem: NO_SUPABASE };
  const db = await reportsDb();
  const events = db as unknown as {
    from(table: 'events'): {
      select(columns: 'event_date'): {
        eq(
          column: 'id',
          value: string,
        ): {
          maybeSingle(): PromiseLike<{
            data: { event_date: string } | null;
            error: { code?: string | null; message: string } | null;
          }>;
        };
      };
    };
  };
  const dated = await events.from('events').select('event_date').eq('id', eventId).maybeSingle();
  if (dated.error) return { ...empty, problem: explain(dated.error) };
  if (!dated.data) return empty;

  const day = dated.data.event_date;
  // The verdict and its fingerprint FIRST, then what the page shows: the
  // lines and violations are then the same as, or newer than, the state
  // the fingerprint vouches for, and a change in between makes the
  // sign-off refuse (changed_since_viewed) rather than pass unseen.
  const list = await readInvoiceEvents(db, day, day);
  if (list.error) return { ...empty, problem: explain(list.error) };
  const [lines, violations] = await Promise.all([
    db.rpc('invoice_event_lines', { p_event: eventId }),
    db.rpc('invoice_event_violations', { p_event: eventId }),
  ]);
  const error = lines.error ?? violations.error;
  if (error) return { ...empty, problem: explain(error) };
  return {
    problem: null,
    event: (list.data ?? []).find((row) => row.event_id === eventId) ?? null,
    lines: (lines.data ?? []) as InvoiceLine[],
    violations: (violations.data ?? []) as InvoiceViolation[],
  };
}

const SEND_COLUMNS =
  'id, kind, period_start, period_end, status, sent_at, created_at, row_count, held_count, error';

const NO_SUPABASE =
  'This environment has no Supabase project, so there is nothing to report on. See docs/04-setup-github-vercel-supabase.md.';

function explain(error: { code?: string | null; message: string }): string {
  return error.message.includes('admins_only')
    ? 'Reports are for the office only. This account is not an admin.'
    : readProblem(error);
}

export interface ReportsData {
  problem: string | null;
  finance: FinanceRow[];
  lines: PayrollLine[];
  people: PayrollPerson[];
  starters: NewStarter[];
  sends: ReportSend[];
  invoices: InvoiceEvent[];
}

export async function loadReports(view: ReportView): Promise<ReportsData> {
  const empty: ReportsData = {
    problem: null,
    finance: [],
    lines: [],
    people: [],
    starters: [],
    sends: [],
    invoices: [],
  };
  if (!supabaseConfigured()) return { ...empty, problem: NO_SUPABASE };
  const db = await reportsDb();

  if (view.tab === 'invoicing') {
    const invoices = await readInvoiceEvents(db, view.from, view.to);
    if (invoices.error) return { ...empty, problem: explain(invoices.error) };
    return { ...empty, invoices: invoices.data };
  }

  const kind = view.tab === 'newstarter' ? 'new_starter' : 'payroll';
  const sendsQuery = db
    .from('report_sends')
    .select(SEND_COLUMNS)
    .eq('kind', kind)
    .order('period_start', { ascending: false })
    .limit(8);

  if (view.tab === 'financial') {
    const [finance, sends] = await Promise.all([
      readFinance(db, view.from, view.to, view.by),
      sendsQuery,
    ]);
    if (finance.error) return { ...empty, problem: explain(finance.error) };
    return {
      ...empty,
      finance: finance.data,
      sends: (sends.data ?? []) as ReportSend[],
    };
  }

  if (view.tab === 'payroll') {
    const [lines, people, sends] = await Promise.all([
      readPayrollLines(db, view.from, view.to),
      readPayrollPeople(db, view.from, view.to),
      sendsQuery,
    ]);
    const error = lines.error ?? people.error;
    if (error) return { ...empty, problem: explain(error) };
    return {
      ...empty,
      lines: lines.data ?? [],
      people: people.data ?? [],
      sends: (sends.data ?? []) as ReportSend[],
    };
  }

  const [starters, sends] = await Promise.all([readNewStarters(db, view.date), sendsQuery]);
  if (starters.error) return { ...empty, problem: explain(starters.error) };
  return {
    ...empty,
    starters: starters.data,
    sends: (sends.data ?? []) as ReportSend[],
  };
}
