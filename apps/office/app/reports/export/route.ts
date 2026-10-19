import { financialCsv, newStarterCsv, payrollCsv } from '@thc/pdf/csv';
import {
  EXPORT_ROW_CEILING,
  readFinance,
  readNewStarters,
  readPayrollLines,
  reportsDb,
  supabaseConfigured,
} from '../data';
import { explainDbError } from '../../_lib/dbError';
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

  // Every read is paged past PostgREST's max_rows and checked against the
  // exact count (reports/data.ts): a file is complete or it is an error,
  // never a payroll that quietly stops at line 1,000 (RULE-14).
  let csv = '';
  let name: string;
  let error: { code?: string | null; message: string } | null;

  if (report === 'payroll') {
    const result = await readPayrollLines(db, view.from, view.to, EXPORT_ROW_CEILING);
    error = result.error;
    if (result.data) csv = payrollCsv(result.data.filter((row) => row.in_export));
    name = `THC payroll ${view.from} to ${view.to}.csv`;
  } else if (report === 'newstarter') {
    const result = await readNewStarters(db, view.date, EXPORT_ROW_CEILING);
    error = result.error;
    if (result.data) csv = newStarterCsv(result.data);
    const period = newStarterPeriod(view.date);
    name = `THC new starters (HMRC) ${period.from} to ${period.to}.csv`;
  } else if (report === 'financial') {
    const result = await readFinance(db, view.from, view.to, view.by, EXPORT_ROW_CEILING);
    error = result.error;
    if (result.data) csv = financialCsv(result.data);
    name = `THC financial ${view.from} to ${view.to} by ${view.by}.csv`;
  } else {
    return new Response('Unknown report.', { status: 400 });
  }

  if (error) {
    // admins_only: not the office at all. not_permitted (42501): an office
    // login without the finance permission — a scheduler (ADR-0056,
    // assert_finance_caller). Both are a refusal, not a server fault.
    const notOffice = error.message.includes('admins_only');
    const noFinance = error.message.includes('not_permitted') || error.code === '42501';
    if (notOffice || noFinance) {
      return new Response(
        notOffice
          ? 'Reports are for the office only.'
          : 'Reports need the finance permission. Ask an owner to check your access on Users & access.',
        { status: 403 },
      );
    }
    return new Response(explainDbError(error, { log: '[reports]' }), { status: 500 });
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
