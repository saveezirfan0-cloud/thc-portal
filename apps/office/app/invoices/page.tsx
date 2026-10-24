import Link from 'next/link';
import { Alert, KpiTile, Panel, TileGrid } from '@thc/ui';
import { NotAvailable } from '../_components/NotAvailable';
import { OfficeShell } from '../_components/OfficeShell';
import { currentOfficeRole } from '../_components/officeUser';
import { officeCan } from '../_lib/permissions';
import { todayInUk } from '../reports/view-model';
import { InvoiceFilters } from './_components/InvoiceFilters';
import { InvoiceTable } from './_components/InvoiceTable';
import { SummaryList } from './_components/SummaryList';
import { loadInvoiceList } from './_lib/data';
import { hours, pounds } from './_lib/format';
import {
  PAGE_SIZE,
  exportHref,
  filterRows,
  listHref,
  monthlySummary,
  paginate,
  parseInvoiceView,
  sortRows,
  totalsOf,
  weeklySummary,
} from './_lib/view-model';
import type { InvoiceTab } from './_lib/view-model';
import '../reports/reports.css';
import './invoices.css';

export const metadata = { title: 'Invoices · THC Back Office' };

// A number is taken, a PDF is drawn, an email goes: the list moves.
export const dynamic = 'force-dynamic';

const TABS: { tab: InvoiceTab; label: string }[] = [
  { tab: 'all', label: 'All Invoices' },
  { tab: 'weekly', label: 'Weekly Summary' },
  { tab: 'monthly', label: 'Monthly Summary' },
];

/**
 * /invoices — "All generated invoices", `wireframes/backoffice/invoices.html`
 * (ADR-0210; audit §2.4). Both sources in one list, on the one number series:
 * the sign-in-log invoices the system issues itself (ADR-0176) and the
 * timesheet invoices the office generates (ADR-0210), each with its Xero
 * state. Finance only (ADR-0056): the tables are finance-gated, so a
 * scheduler is told so before anything is asked.
 *
 * Every filter lives in the URL. The figures are the database's; the KPI
 * strip and the summaries only add them up, in whole pence.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return <NotAvailable activeHref="/invoices" title="Invoices" role={role} needs="finance" />;
  }
  const canWrite = officeCan(role, 'write');

  const today = todayInUk();
  const view = parseInvoiceView(await searchParams, today);
  const data = await loadInvoiceList(view);

  const rows = filterRows(data.rows, view);
  const totals = totalsOf(rows);
  const sorted = sortRows(rows, view);
  const page = paginate(sorted, view.page);

  return (
    <OfficeShell
      activeHref="/invoices"
      title="Invoices"
      crumbs={
        <>
          one number series from 4000 · every invoice goes to Xero ·{' '}
          <Link href="/reports?tab=invoicing">Ready to invoice (events)</Link>
        </>
      }
    >
      <div className="stack">
        <div className="inv-head">
          <h2>All generated invoices</h2>
          <span className="muted">
            {totals.count} {totals.count === 1 ? 'invoice' : 'invoices'} | {pounds(totals.total)}{' '}
            total
          </span>
          <div className="right">
            {canWrite ? (
              <Link className="btn sm primary" href="/invoices/process">
                + Process timesheet
              </Link>
            ) : null}
            <details className="inv-menu">
              <summary className="btn sm">Export ▾</summary>
              <div className="items">
                <a href={exportHref(view)}>Export as CSV</a>
                <span className="off">CSV carries the filtered list. Excel is per invoice.</span>
              </div>
            </details>
          </div>
        </div>

        <nav className="tabs" aria-label="Invoice views">
          {TABS.map(({ tab, label }) => (
            <Link
              key={tab}
              href={listHref(view, { tab, page: 1 })}
              className={tab === view.tab ? 'active' : undefined}
              aria-current={tab === view.tab ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

        <Panel>
          <InvoiceFilters view={view} clients={data.clients} />
        </Panel>

        <TileGrid columns={4} compact>
          <KpiTile label="Invoices" value={totals.count} description="matching the filters" />
          <KpiTile
            label="Total"
            tone="accent"
            value={pounds(totals.total)}
            description="amount due, VAT included"
          />
          <KpiTile label="Hours" value={hours(totals.hours)} description="payable hours invoiced" />
          <KpiTile label="Average" value={pounds(totals.average)} description="per invoice" />
        </TileGrid>

        {view.tab === 'all' ? (
          <Panel flush>
            <div className="panel-b tight">
              <InvoiceTable rows={page.rows} view={view} />
            </div>
            <div className="rp-pager">
              <span className="muted sm">
                {page.total === 0
                  ? 'Nothing to show'
                  : `Showing ${(page.page - 1) * PAGE_SIZE + 1}–${(page.page - 1) * PAGE_SIZE + page.rows.length} of ${page.total}`}
              </span>
              <div className="right">
                {page.page > 1 ? (
                  <Link className="btn sm ghost" href={listHref(view, { page: page.page - 1 })}>
                    ‹ Prev
                  </Link>
                ) : (
                  <span className="btn sm ghost" aria-disabled="true">
                    ‹ Prev
                  </span>
                )}
                <span className="mono sm">
                  {page.page} / {page.pages}
                </span>
                {page.page < page.pages ? (
                  <Link className="btn sm ghost" href={listHref(view, { page: page.page + 1 })}>
                    Next ›
                  </Link>
                ) : (
                  <span className="btn sm ghost" aria-disabled="true">
                    Next ›
                  </span>
                )}
              </div>
            </div>
          </Panel>
        ) : null}

        {view.tab === 'weekly' ? (
          <SummaryList
            groups={weeklySummary(rows)}
            empty="No invoice matches these filters, so there is no week to summarise."
          />
        ) : null}
        {view.tab === 'monthly' ? (
          <SummaryList
            groups={monthlySummary(rows)}
            empty="No invoice matches these filters, so there is no month to summarise."
          />
        ) : null}
      </div>
    </OfficeShell>
  );
}
