import { NextResponse } from 'next/server';
import { loadMonthReport } from '../../data';
import { monthRange, parseMonth, timeCsv } from '../../view-model';

export const dynamic = 'force-dynamic';

/**
 * /tickets/time/export?month=2026-10 — the month's time as CSV, one row per
 * entry (ADR-0202). The same read as the page: a login that is not the
 * tracker gets a 404, never a file.
 */
export async function GET(request: Request) {
  const month = parseMonth(new URL(request.url).searchParams.get('month') ?? undefined);
  const { from, to } = monthRange(month);
  const report = await loadMonthReport(from, to);
  if (!report.allowed) return new NextResponse('Not found', { status: 404 });
  if (report.problem)
    return new NextResponse('The time report could not be read.', { status: 500 });
  return new NextResponse(timeCsv(report.rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ticket-time-${month}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
