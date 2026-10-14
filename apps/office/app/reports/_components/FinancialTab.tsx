import Link from 'next/link';
import { Alert, KpiTile, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
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
      <div className="rp-toolbar filters">
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
        has its own invoicing process; PO Numbers carry into the timesheet documents, not into this
        figure. Payable hours = the intersection of check-in/out with the scheduled window; a
        section still to finish is forecast at headcount × its hours. Cancelled events contribute
        nothing.
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
        <div className="panel-b tight">
          <TableScroll label="Breakdown" minWidth="52rem">
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
          </TableScroll>
        </div>
      </Panel>
    </div>
  );
}

/** How many live event names a row shows before folding the rest away. */
const SHOWN_EVENTS = 3;

function GroupRow({ row }: { row: FinanceRow }) {
  const cancelled = row.cancelled_events ?? [];
  const excludedOnly = row.event_count === 0 && cancelled.length > 0;
  if (excludedOnly) {
    return (
      <tr>
        <td className="rp-nowrap">{row.group_label}</td>
        <td className="rp-events">
          <Cancelled names={cancelled} open />
        </td>
        {Array.from({ length: 6 }, (_, i) => (
          <td key={i} className="money muted">
            —
          </td>
        ))}
        <td>
          <div className="rp-status">
            <Pill>excluded</Pill>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="rp-nowrap">{row.group_label}</td>
      <td className="rp-events">
        <EventNames count={row.event_count} names={row.events ?? []} />
        {cancelled.length > 0 ? <Cancelled names={cancelled} /> : null}
      </td>
      <td className="money">{hours(row.payable_min)}</td>
      <td className="money">{pounds(row.base)}</td>
      <td className="money muted">{pounds(row.holiday)}</td>
      <td className="money">{pounds(row.payroll)}</td>
      <td className="money">{pounds(row.invoicing)}</td>
      <td className={`money ${num(row.margin) < 0 ? 'rp-coral' : 'rp-green'}`}>
        {pounds(row.margin)}
      </td>
      <td>
        <StatusPills row={row} />
      </td>
    </tr>
  );
}

/**
 * One event per line, each cut to the column with the full name on hover,
 * instead of a single run-on sentence wrapping down the cell. Past
 * SHOWN_EVENTS the rest fold behind "+N more".
 */
function EventNames({ count, names }: { count: number; names: readonly string[] }) {
  const shown = names.slice(0, SHOWN_EVENTS);
  const rest = names.slice(SHOWN_EVENTS);
  return (
    <>
      <span className="rp-count">
        {count} {count === 1 ? 'event' : 'events'}
      </span>
      {shown.length > 0 ? (
        <ul className="rp-names">
          {shown.map((name, i) => (
            <li key={i} title={name}>
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length > 0 ? (
        <details className="rp-more">
          <summary>+{rest.length} more</summary>
          <ul className="rp-names">
            {rest.map((name, i) => (
              <li key={i} title={name}>
                {name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/**
 * Cancelled events contribute nothing (§9.9), so they fold to one line —
 * "2 cancelled · excluded" — and open to the struck-through names.
 */
function Cancelled({ names, open }: { names: readonly string[]; open?: boolean }) {
  return (
    <details className="rp-more rp-cancelled" open={open}>
      <summary>{names.length} cancelled · excluded</summary>
      <ul className="rp-names">
        {names.map((name, i) => (
          <li key={i} title={name}>
            <s>{name}</s>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * `financialStatus()` as separate pills, each in its own tone, rather than
 * one long pill: "1 shift pending" and "forecast" amber, "actual" green.
 * The cancelled part is left to the Events cell, which already says it;
 * the full status string (as the CSV writes it) is on hover.
 */
function StatusPills({ row }: { row: FinanceRow }) {
  const pills: { label: string; tone?: 'amber' | 'green' }[] = [];
  if (row.pending > 0) {
    pills.push({
      label: `${row.pending} shift${row.pending === 1 ? '' : 's'} pending`,
      tone: 'amber',
    });
  }
  if (row.forecast_sections > 0 && row.actual_sections > 0) {
    pills.push({ label: 'actual + forecast', tone: 'amber' });
  } else if (row.forecast_sections > 0) pills.push({ label: 'forecast', tone: 'amber' });
  else if (row.actual_sections > 0) pills.push({ label: 'actual', tone: 'green' });
  return (
    <div className="rp-status" title={financialStatus(row)}>
      {pills.map((p) => (
        <Pill key={p.label} tone={p.tone}>
          {p.label}
        </Pill>
      ))}
    </div>
  );
}
