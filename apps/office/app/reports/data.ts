import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { FinancialCsvRow, NewStarterCsvRow, PayrollCsvRow } from '@thc/pdf';
import type { ReportSend, ReportView } from './view-model';

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

/**
 * `packages/db`'s generated types predate these functions (their `Functions`
 * map is the Phase 0 placeholder), so the RPCs are typed here by name.
 * Regenerating with `pnpm --filter @thc/db gen:types` makes this redundant.
 */
export interface ReportsRpc {
  rpc(
    fn: 'payroll_report' | 'payroll_report_people',
    args: { p_from: string; p_to: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: 'finance_report',
    args: { p_from: string; p_to: string; p_by: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: 'new_starter_report',
    args: { p_date: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: 'retry_finance_report',
    args: { p_send: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
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

const SEND_COLUMNS =
  'id, kind, period_start, period_end, status, sent_at, created_at, row_count, held_count, error';

const NO_SUPABASE =
  'This environment has no Supabase project, so there is nothing to report on. See docs/04-setup-github-vercel-supabase.md.';

function explain(message: string): string {
  return message.includes('admins_only')
    ? 'Reports are for the office only. This account is not an admin.'
    : message;
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
      db.rpc('finance_report', { p_from: view.from, p_to: view.to, p_by: view.by }),
      sendsQuery,
    ]);
    if (finance.error) return { ...empty, problem: explain(finance.error.message) };
    return {
      ...empty,
      finance: (finance.data ?? []) as FinanceRow[],
      sends: (sends.data ?? []) as ReportSend[],
    };
  }

  if (view.tab === 'payroll') {
    const [lines, people, sends] = await Promise.all([
      db.rpc('payroll_report', { p_from: view.from, p_to: view.to }),
      db.rpc('payroll_report_people', { p_from: view.from, p_to: view.to }),
      sendsQuery,
    ]);
    const error = lines.error ?? people.error;
    if (error) return { ...empty, problem: explain(error.message) };
    return {
      ...empty,
      lines: (lines.data ?? []) as PayrollLine[],
      people: (people.data ?? []) as PayrollPerson[],
      sends: (sends.data ?? []) as ReportSend[],
    };
  }

  const [starters, sends] = await Promise.all([
    db.rpc('new_starter_report', { p_date: view.date }),
    sendsQuery,
  ]);
  if (starters.error) return { ...empty, problem: explain(starters.error.message) };
  return {
    ...empty,
    starters: (starters.data ?? []) as NewStarter[],
    sends: (sends.data ?? []) as ReportSend[],
  };
}
