import { Suspense } from 'react';
import Link from 'next/link';
import { SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { AutoRefresh } from '../_components/AutoRefresh';
import { DashboardBody } from './DashboardBody';
import { ViewerZone } from './_components/ViewerZone';
import { dashboardView } from './view';
import { formatAsOf } from './view-model';
import './dashboard.css';

export const metadata = { title: 'Dashboard · THC Back Office' };

/**
 * Every number on this screen is "as of this minute" (§9.1). Caching one
 * for even a second would be caching the answer to "what is on fire right
 * now", which is the only question the screen asks.
 */
export const dynamic = 'force-dynamic';

/** The topbar's "as of" line: it needs the figures' timestamp, so it streams too. */
async function AsOf() {
  const { kpis, format } = await dashboardView();
  if (!kpis) return null;
  const asOf = formatAsOf(new Date(kpis.asOf), format);
  return (
    <>
      as of <b>{asOf.time} UK time</b> · {asOf.date}
    </>
  );
}

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
 *
 * The page itself reads nothing: the topbar and chrome paint at once and the
 * figures stream in behind a skeleton. There is ONE `OfficeShell`, outside
 * the Suspense — a skeleton that drew its own shell put two topbars in the
 * document during the swap (`app/__tests__/boundaries.test.tsx`).
 */
export default function Page() {
  return (
    <OfficeShell
      activeHref="/dashboard"
      title="Dashboard"
      crumbs={
        <Suspense fallback={null}>
          <AsOf />
        </Suspense>
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
      {/* "As of this minute": the figures move on their own (§9.1). */}
      <AutoRefresh />
      <Suspense
        fallback={
          <SkeletonScreen label="Loading the dashboard">
            <SkeletonKpis count={4} />
            <SkeletonPanel rows={4} lines={2} />
            <SkeletonPanel rows={6} />
          </SkeletonScreen>
        }
      >
        <DashboardBody />
      </Suspense>
    </OfficeShell>
  );
}
