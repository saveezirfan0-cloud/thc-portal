import { Suspense } from 'react';
import Link from 'next/link';
import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { AutoRefresh } from '../_components/AutoRefresh';
import { ViewerZone } from '../checkin/ViewerZone';
import { ComplianceBody } from './ComplianceBody';
import { complianceView } from './view';
import './compliance.css';

export const metadata = { title: 'Compliance · THC Back Office' };
/** A queue and a clock: nothing about either may be cached. */
export const dynamic = 'force-dynamic';

/** The topbar's counts need the queue, so they stream with it. */
async function Counts() {
  const data = await complianceView();
  const blocked = new Set(
    [...data.queue, ...data.radar].filter((r) => r.status === 'blocked').map((r) => r.staff_id),
  ).size;
  return (
    <>
      review queue + expiry radar · <b>{data.queue.length} to review</b> · {blocked} blocked
    </>
  );
}

/**
 * /compliance — §4.1–4.3, `wireframes/backoffice/compliance.html`. The
 * topbar names the reader's own zone; every stamp on the screen is an audit
 * stamp and is UK time whoever reads it.
 *
 * Read on the server as the manager: every source is a security_invoker view,
 * so RLS decides what comes back and this page tests no role of its own.
 *
 * The topbar and chrome paint at once; the queue streams in behind a
 * skeleton. One `OfficeShell`, outside the Suspense (see /dashboard).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // `?tab=radar` is how the dashboard's "view radar →" (§9.1) lands on the
  // Radar rather than the queue; `?tab=checks` opens the gov.uk check monitor.
  // Anything else opens the default tab.
  const { tab } = await searchParams;

  return (
    <OfficeShell
      activeHref="/compliance"
      title="Compliance"
      crumbs={
        <Suspense fallback={<>review queue + expiry radar</>}>
          <Counts />
        </Suspense>
      }
      timezone={<ViewerZone />}
      actions={
        <>
          <Link className="btn ghost sm" href="/staff?view=student">
            Student visa view
          </Link>
          <a className="btn ghost sm" href="/compliance/export">
            Export audit (CSV)
          </a>
        </>
      }
    >
      {/* New uploads and the gov.uk checks land in the queue on their own. */}
      <AutoRefresh />
      <Suspense
        fallback={
          <SkeletonScreen label="Loading the review queue">
            <SkeletonToolbar controls={2} />
            <SkeletonPanel rows={6} avatar />
          </SkeletonScreen>
        }
      >
        <ComplianceBody tab={tab === 'radar' || tab === 'checks' ? tab : 'review'} />
      </Suspense>
    </OfficeShell>
  );
}
