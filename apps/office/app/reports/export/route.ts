import { financialCsv, newStarterCsv, payrollCsv } from '@thc/pdf/csv';
import { reportsDb, supabaseConfigured } from '../data';
import type { FinanceRow, NewStarter, PayrollLine } from '../data';
import { newStarterPeriod, parseReportView, todayInUk } from '../view-model';

/**
 * "Export CSV" on each /reports tab (§9.9).
 *
 * The same builders the Monday send uses (packages/pdf/src/csv.ts), fed by
 * the same SQL, so a manual export of last week and Monday's email agree
 * column for column. The Payroll export is one row per SHIFT and leaves out
 * every row the database marked `in_export = false` — a shift HELD for an
 * unresolved No check-out, and a late turn-away paid nothing.
 *
 * Runs as the signed-in user: the report functions raise `admins_only` for
 * anybody else, and that becomes a 403 here.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return new Response('This environment has no Supabase project.', { status: 503 });
  }
  const url = new URL(request.url);
  const report = url.searchParams.get('report');
  const view = parseReportView(
    {
      tab: report ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      by: url.searchParams.get('by') ?? undefined,
      date: url.searchParams.get('date') ?? undefined,
    },
    todayInUk(),
  );
  const db = await reportsDb();

  let csv: string;
  let name: string;
  let error: { message: string } | null;

  if (report === 'payroll') {
    const result = await db.rpc('payroll_report', { p_from: view.from, p_to: view.to });
    error = result.error;
    csv = payrollCsv(((result.data ?? []) as PayrollLine[]).filter((row) => row.in_export));
    name = `THC payroll ${view.from} to ${view.to}.csv`;
  } else if (report === 'newstarter') {
    const result = await db.rpc('new_starter_report', { p_date: view.date });
    error = result.error;
    csv = newStarterCsv((result.data ?? []) as NewStarter[]);
    const period = newStarterPeriod(view.date);
    name = `THC new starters (HMRC) ${period.from} to ${period.to}.csv`;
  } else if (report === 'financial') {
    const result = await db.rpc('finance_report', {
      p_from: view.from,
      p_to: view.to,
      p_by: view.by,
    });
    error = result.error;
    csv = financialCsv((result.data ?? []) as FinanceRow[]);
    name = `THC financial ${view.from} to ${view.to} by ${view.by}.csv`;
  } else {
    return new Response('Unknown report.', { status: 400 });
  }

  if (error) {
    const forbidden = error.message.includes('admins_only');
    return new Response(forbidden ? 'Reports are for the office only.' : error.message, {
      status: forbidden ? 403 : 500,
    });
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
