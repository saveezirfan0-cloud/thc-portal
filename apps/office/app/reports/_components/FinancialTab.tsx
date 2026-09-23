import Link from 'next/link';
import { Alert, KpiTile, Panel, Pill, TileGrid } from '@thc/ui';
import { financialStatus } from '@thc/pdf/csv';
import type { FinanceRow } from '../data';
import {
  exportHref,
  hours,
  hoursKpi,
  num,
  periodLabel,
  pounds,
  poundsWhole,
  reportHref,
  showForecastLabel,
  thisWeek,
} from '../view-model';
import type { FinanceBy, ReportView } from '../view-model';
import { RangeForm } from './RangeForm';

const GROUP_HEAD: Record<FinanceBy, string> = { day: 'Day', client: 'Client', role: 'Role' };

/**
 * Tab 1 · Financial report (§9.9).
 *
 * Three KPIs — Staff payroll with base and the 12.07% holiday element shown
 * separately and never blended; Client invoicing at the charge rate, which
 * is a revenue FORECAST and not the PO-based invoices; Gross margin after
 * holiday — and the breakdown by day, client or role. Every figure is
 * `finance_report()`'s.
 */
export function FinancialTab({
  view,
  rows,
  today,
}: {
  view: ReportView;
  rows: FinanceRow[];
  today: string;
}) {
  const total = rows.find((r) => r.is_total) ?? null;
  const groups = rows.filter((r) => !r.is_total);
  const week = thisWeek(today);
  const onThisWeek = view.from === week.from && view.to === week.to;
  const forecast = showForecastLabel(view.from, view.to, today);

  return (
    <div className="stack">
      <div className="rp-toolbar">
        <Link
          className={`btn sm${onThisWeek ? ' primary' : ''}`}
          href={reportHref(view, { ...week })}
        >
          This week
        </Link>
        <RangeForm view={view} />
        {forecast ? (
          <Pill tone="amber" large>
            Forecast for the period
          </Pill>
        ) : null}
        <div className="right">
          <a className="btn sm" href={exportHref(view)}>
            Export CSV
          </a>
        </div>
      </div>

      <TileGrid columns={3}>
        <KpiTile
          label="Staff payroll"
          value={poundsWhole(total?.payroll)}
          description={
            <>
              payable hours × base rate, holiday broken out — never blended
              <span className="rp-split">
                <span>
                  Base <b>{poundsWhole(total?.base)}</b>
                </span>
                <span>
                  Holiday +12.07% <b>{poundsWhole(total?.holiday)}</b>
                </span>
              </span>
            </>
          }
        />
        <KpiTile
          label="Client invoicing · at the charge rate"
          tone="accent"
          value={poundsWhole(total?.invoicing)}
          description={
            <>
              {hoursKpi(total?.payable_min)} payable hours × each role&apos;s charge rate
              <span className="rp-split">
                <span className="rp-amber">Revenue forecast — NOT the PO-based invoices</span>
              </span>
            </>
          }
        />
        <KpiTile
          label="Gross margin"
          tone="ok"
          value={poundsWhole(total?.margin)}
          description={
            <>
              invoicing − payroll incl. holiday
              <span className="rp-split">
                <span>
                  {total?.margin_pct === null || total === null
                    ? '—'
                    : `${num(total.margin_pct).toFixed(1)}%`}
                </span>
                <span>after holiday pay</span>
              </span>
            </>
          }
        />
      </TileGrid>

      <Alert tone="cyan">
        <b>Invoicing here is a revenue forecast for the period, not the PO-based invoices.</b> THC
        has its own invoicing process; PO Numbers carry into the timesheet documents (§3.2, §11.3),
        not into this figure. Payable hours = the intersection of check-in/out with the scheduled
        window (RULE-01, §5.2); a section still to finish is forecast at headcount × its hours.
        Cancelled events contribute nothing (§3.3).
      </Alert>

      <Panel
        title={<>Breakdown · {periodLabel(view.from, view.to)}</>}
        actions={
          <div className="seg sm" role="group" aria-label="Group by">
            {(['day', 'client', 'role'] as const).map((by) => (
              <Link
                key={by}
                className={view.by === by ? 'on' : undefined}
                href={reportHref(view, { by })}
              >
                By {by}
              </Link>
            ))}
          </div>
        }
        flush
      >
        <div className="panel-b tight table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>{GROUP_HEAD[view.by]}</th>
                <th>Events</th>
                <th className="money">Payable hours</th>
                <th className="money">Base payroll</th>
                <th className="money">Holiday +12.07%</th>
                <th className="money">Payroll incl. holiday</th>
                <th className="money">Invoicing</th>
                <th className="money">Margin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    Nothing was scheduled in this period.
                  </td>
                </tr>
              ) : (
                groups.map((row) => <GroupRow key={row.group_key ?? ''} row={row} />)
              )}
              {total ? (
                <tr className="rp-total">
                  <td>
                    <b>Total</b>
                  </td>
                  <td />
                  <td className="money">
                    <b>{hours(total.payable_min)}</b>
                  </td>
                  <td className="money">
                    <b>{pounds(total.base)}</b>
                  </td>
                  <td className="money">
                    <b>{pounds(total.holiday)}</b>
                  </td>
                  <td className="money">
                    <b>{pounds(total.payroll)}</b>
                  </td>
                  <td className="money">
                    <b>{pounds(total.invoicing)}</b>
                  </td>
                  <td className={`money ${num(total.margin) < 0 ? 'rp-coral' : 'rp-green'}`}>
                    <b>{pounds(total.margin)}</b>
                  </td>
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function GroupRow({ row }: { row: FinanceRow }) {
  const excludedOnly = row.event_count === 0 && (row.cancelled_events?.length ?? 0) > 0;
  const status = financialStatus(row);
  if (excludedOnly) {
    return (
      <tr>
        <td className="rp-nowrap">{row.group_label}</td>
        <td className="sm muted">
          <s>{row.cancelled_events!.join(' · ')}</s> · cancelled
        </td>
        {Array.from({ length: 6 }, (_, i) => (
          <td key={i} className="money muted">
            —
          </td>
        ))}
        <td className="sm">
          <Pill>excluded</Pill>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="rp-nowrap">{row.group_label}</td>
      <td className="sm">
        {row.event_count} · {(row.events ?? []).join(' · ')}
        {(row.cancelled_events?.length ?? 0) > 0 ? (
          <span className="sub">
            <s>{row.cancelled_events!.join(' · ')}</s> · cancelled, excluded
          </span>
        ) : null}
      </td>
      <td className="money">{hours(row.payable_min)}</td>
      <td className="money">{pounds(row.base)}</td>
      <td className="money muted">{pounds(row.holiday)}</td>
      <td className="money">{pounds(row.payroll)}</td>
      <td className="money">{pounds(row.invoicing)}</td>
      <td className={`money ${num(row.margin) < 0 ? 'rp-coral' : 'rp-green'}`}>
        {pounds(row.margin)}
      </td>
      <td className="sm">
        <Pill tone={row.pending > 0 || row.forecast_sections > 0 ? 'amber' : 'green'}>
          {status}
        </Pill>
      </td>
    </tr>
  );
}
