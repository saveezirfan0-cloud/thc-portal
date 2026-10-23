import { notFound } from 'next/navigation';
import { currentTimeFormat } from '../../_lib/timeFormat';
import { loadMonthReport, loadTicketChoices } from '../data';
import { TimeReportScreen } from './TimeReportScreen';
import { monthRange, parseMonth } from '../view-model';

export const metadata = { title: 'Time report · THC Back Office' };
export const dynamic = 'force-dynamic';

/**
 * /tickets/time — the month's time, for the bill (ADR-0202). Only the login
 * that tracks sees it; anyone else gets the same 404 as a page that is not
 * there, so the page does not even say it exists.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const month = parseMonth((await searchParams)['month']);
  const { from, to } = monthRange(month);
  const [report, choices] = await Promise.all([
    loadMonthReport(from, to),
    loadTicketChoices(),
    currentTimeFormat(),
  ]);
  if (!report.allowed && !report.problem) notFound();
  return <TimeReportScreen month={month} report={report} choices={choices} />;
}
