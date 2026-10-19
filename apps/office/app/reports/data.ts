import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { DEFAULT_ROW_CEILING, readAllPages } from '@thc/db/paged';
import type { PageReply, ReadAllResult } from '@thc/db/paged';
import type { FinancialCsvRow, NewStarterCsvRow, PayrollCsvRow } from '@thc/pdf';
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
}

export async function loadReports(view: ReportView): Promise<ReportsData> {
  const empty: ReportsData = {
    problem: null,
    finance: [],
    lines: [],
    people: [],
    starters: [],
    sends: [],
  };
  if (!supabaseConfigured()) return { ...empty, problem: NO_SUPABASE };
  const db = await reportsDb();

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
