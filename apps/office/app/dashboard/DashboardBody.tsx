import Link from 'next/link';
import { Alert, KpiTile, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import { ShortStaffedPanel } from './_components/ShortStaffedPanel';
import { UpcomingTable } from './_components/UpcomingTable';
import { dashboardView } from './view';
import { formatHours, formatPercent, formatPounds, formatWeekRange, todayInUk } from './view-model';

/**
 * The Dashboard's content (§9.1), streamed in behind the topbar by
 * `page.tsx`. Every number is "as of this minute", so nothing here is cached
 * beyond the one request.
 */
export async function DashboardBody() {
  const { showMoney, kpis, finance, upcoming, problem, shortStaffed } = await dashboardView();
  const today = todayInUk();

  return (
    <div className="stack">
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      {/* ---- the four operational KPIs, on one row (§9.1) ---------- */}
      <TileGrid columns={4}>
        <KpiTile
          label="Open positions"
          // Accent, as the wireframe draws it: §9.1's "headline number of
          // the business", not a warning.
          tone="accent"
          value={kpis?.openPositions ?? '—'}
          description="Sold but not staffed — all events, any date"
        />
        <KpiTile
          label="On shift now"
          tone="ok"
          value={kpis?.onShiftNow ?? '—'}
          description="Checked in and on site this minute"
        />
        <KpiTile
          label="Staff available"
          value={kpis?.staffAvailable ?? '—'}
          description="Compliant workers, not booked or blocked"
        />
        <KpiTile
          label="Compliance blocks"
          tone="danger"
          value={kpis?.complianceBlocks ?? '—'}
          // The wireframe hangs "view radar →" here and §9.1 wants it.
          // A query, not the wireframe's #fragment: the page is rendered
          // on the server, which never sees a fragment.
          description={
            <>
              Blocked over documents <Link href="/compliance?tab=radar">view radar →</Link>
            </>
          }
        />
      </TileGrid>

      {/* ---- role sections starting in 48 h below headcount -------- */}
      <ShortStaffedPanel roles={shortStaffed.roles} problem={shortStaffed.problem} />

      {/* ---- the current week, Mon–Sun (§9.1) ---------------------- */}
      {showMoney ? (
        <Panel
          title={
            <>
              This week · financial snapshot{' '}
              {finance ? <Pill>{formatWeekRange(finance.weekStart, finance.weekEnd)}</Pill> : null}{' '}
              {/* §9.9 calls this out on the Financial tab too: what is
                  shown for a week still running is a forecast, not
                  payroll. Saying so is part of the number. */}
              <Pill tone="amber">Forecast for the period</Pill>
            </>
          }
          // The wireframe's "Full report →", to the Financial reports (§9.9).
          actions={
            <Link className="sm" href="/reports">
              Full report →
            </Link>
          }
        >
          {finance ? (
            <div className="dash-finance">
              <KpiTile
                flat
                small
                label="Chargeable (client invoicing)"
                value={formatPounds(finance.chargeTotal)}
                description={`${formatHours(finance.forecastHours)} forecast hours at charge rate · ${finance.events} ${
                  finance.events === 1 ? 'event' : 'events'
                }`}
              />
              <KpiTile
                flat
                small
                label="Payable (incl. holiday +12.07%)"
                value={formatPounds(finance.payTotal)}
                description={
                  // §1.5: broken out, never blended. Two figures side by
                  // side, not one total with an asterisk.
                  <span className="dash-split">
                    <span>
                      <span>Base {formatPounds(finance.baseTotal)}</span> ·{' '}
                      <span>Holiday {formatPounds(finance.holidayTotal)}</span>
                    </span>
                    <span className="muted">never blended</span>
                  </span>
                }
              />
              <KpiTile
                flat
                small
                tone="ok"
                label="Gross margin"
                value={formatPounds(finance.marginTotal)}
                description={`${formatPercent(finance.marginPct)} · after holiday pay`}
              />
            </div>
          ) : (
            <p className="muted sm">No figures for this week.</p>
          )}
        </Panel>
      ) : null}

      {/* ---- the next ten days, by date (§9.1) --------------------- */}
      <Panel
        title={
          <>
            Upcoming events <span className="muted sm">· next 10 days</span>
            <span className="muted sm dash-note">
              Event window = earliest role start → latest role end
            </span>
          </>
        }
        actions={
          <Link className="btn sm" href="/events">
            Open scheduling
          </Link>
        }
        flush
      >
        <div className="panel-b tight">
          {/* docs/07: tables scroll horizontally under 820px. */}
          <TableScroll>
            <UpcomingTable events={upcoming} today={today} showMargin={showMoney} />
          </TableScroll>
        </div>
      </Panel>
    </div>
  );
}
