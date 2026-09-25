import Link from 'next/link';
import { Alert, KpiTile, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { UpcomingTable } from './_components/UpcomingTable';
import { ViewerZone } from './_components/ViewerZone';
import { loadDashboard } from './data';
import {
  formatAsOf,
  formatHours,
  formatPercent,
  formatPounds,
  formatWeekRange,
  todayInUk,
} from './view-model';
import './dashboard.css';

export const metadata = { title: 'Dashboard · THC Back Office' };

/**
 * Every number on this screen is "as of this minute" (§9.1). Caching one
 * for even a second would be caching the answer to "what is on fire right
 * now", which is the only question the screen asks.
 */
export const dynamic = 'force-dynamic';

/**
 * /dashboard — Scope §9.1, `wireframes/backoffice/dashboard.html`, and the
 * `BO1 Dashboard` frame in `design-handoff/`.
 *
 * The first screen after login, and the one that answers "what is on fire
 * right now": four operational counters, the current Mon–Sun week's money,
 * and the next ten days with the margin on every role.
 *
 * None of those figures is computed here — see `data.ts` and
 * `supabase/migrations/20260922182000_dashboard_kpis.sql`. Fill, the
 * 12.07% holiday element and the Europe/London week each have exactly one
 * definition in this platform, and a screen that re-derived any of them
 * would be the second.
 */
export default async function Page() {
  const { kpis, finance, upcoming, problem } = await loadDashboard();
  const asOf = kpis ? formatAsOf(new Date(kpis.asOf)) : null;
  const today = todayInUk();

  return (
    <OfficeShell
      activeHref="/dashboard"
      title="Dashboard"
      crumbs={
        asOf ? (
          <>
            as of <b>{asOf.time} UK time</b> · {asOf.date}
          </>
        ) : null
      }
      // The windows below are scheduled times, so the topbar names the
      // reader's own zone and the rows carry both (§1.8).
      timezone={<ViewerZone />}
      actions={
        <Link className="btn primary sm" href="/events/new">
          + New event
        </Link>
      }
    >
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

        {/* ---- the current week, Mon–Sun (§9.1) ---------------------- */}
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

        {/* ---- the next ten days, by date (§9.1) --------------------- */}
        <Panel
          title={
            <>
              Upcoming events <span className="muted sm">· next 10 days</span>{' '}
              <span className="muted sm">
                Event window = earliest role start → latest role end (RULE-18)
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
              <UpcomingTable events={upcoming} today={today} />
            </TableScroll>
          </div>
        </Panel>
      </div>
    </OfficeShell>
  );
}
