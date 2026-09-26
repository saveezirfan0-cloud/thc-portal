import Link from 'next/link';
import { Alert } from '@thc/ui';
import { NotAvailable } from '../_components/NotAvailable';
import { OfficeShell } from '../_components/OfficeShell';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { FinancialTab } from './_components/FinancialTab';
import { NewStarterTab } from './_components/NewStarterTab';
import { PayrollTab } from './_components/PayrollTab';
import { ViewerZone } from './_components/zone';
import { loadReports } from './data';
import { parseReportView, reportHref, todayInUk } from './view-model';
import type { ReportTab } from './view-model';
import './reports.css';

export const metadata = { title: 'Reports · THC Back Office' };

// Payable time moves as workers check out and managers resolve violations.
export const dynamic = 'force-dynamic';

const TABS: { tab: ReportTab; label: string }[] = [
  { tab: 'financial', label: 'Financial report' },
  { tab: 'payroll', label: 'Payroll report' },
  { tab: 'newstarter', label: 'New Starter (HMRC)' },
];

/**
 * /reports — Scope §9.9, `wireframes/backoffice/reports.html`.
 *
 * Three tabs over one question, what is owed for the work that happened,
 * and the Monday 09:00 automatic send-out (BG-08) that answers it for
 * finance without anybody pressing anything. The tabs "remain in the UI
 * for looking back at past periods manually".
 *
 * The tab and the period live in the URL, so a report can be bookmarked
 * and every figure is server-rendered from the database's own pricing
 * (`20260923130000_reports_and_finance_send.sql`) — nothing is added up
 * here.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ADR-0050: money only. The report RPCs refuse a scheduler anyway
  // (assert_finance_caller); this says so before three of them are asked.
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return <NotAvailable activeHref="/reports" title="Reports" role={role} needs="finance" />;
  }

  const today = todayInUk();
  const view = parseReportView(await searchParams, today);
  const data = await loadReports(view);

  return (
    <OfficeShell
      activeHref="/reports"
      title="Reports"
      crumbs={
        <>
          three tabs · automatic send-out every <b>Monday 09:00</b> to
          thc_payroll@topsourceworldwide.com + gisela@thehospitalitycompany.co.uk
        </>
      }
      timezone={<ViewerZone />}
    >
      <div className="stack">
        <nav className="tabs" aria-label="Report">
          {TABS.map(({ tab, label }) => (
            <Link
              key={tab}
              href={reportHref({ ...view, tab }, tab === view.tab ? {} : defaultsFor(tab, today))}
              className={tab === view.tab ? 'active' : undefined}
              aria-current={tab === view.tab ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

        {view.tab === 'financial' ? (
          <FinancialTab view={view} rows={data.finance} today={today} />
        ) : null}
        {view.tab === 'payroll' ? (
          <PayrollTab
            view={view}
            people={data.people}
            lines={data.lines}
            sends={data.sends}
            today={today}
          />
        ) : null}
        {view.tab === 'newstarter' ? (
          <NewStarterTab view={view} starters={data.starters} sends={data.sends} />
        ) : null}
      </div>
    </OfficeShell>
  );
}

/** Switching tab opens it on its own default period, not the last tab's. */
function defaultsFor(tab: ReportTab, today: string) {
  const view = parseReportView({ tab }, today);
  return { from: view.from, to: view.to, date: view.date };
}
