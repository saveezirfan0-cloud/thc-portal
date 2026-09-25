import Link from 'next/link';
import { OfficeShell } from '../_components/OfficeShell';
import { ComplianceScreen } from './ComplianceScreen';
import { loadCompliance } from './data';
import './compliance.css';

export const metadata = { title: 'Compliance · THC Back Office' };
/** A queue and a clock: nothing about either may be cached. */
export const dynamic = 'force-dynamic';

/**
 * /compliance — §4.1–4.3, `wireframes/backoffice/compliance.html`.
 *
 * Read on the server as the manager: every source is a security_invoker view,
 * so RLS decides what comes back and this page tests no role of its own.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // `?tab=radar` is how the dashboard's "view radar →" (§9.1) lands on the
  // Radar rather than the queue. Anything else opens the default tab.
  const { tab } = await searchParams;
  const data = await loadCompliance();
  const blocked = new Set(
    [...data.queue, ...data.radar].filter((r) => r.status === 'blocked').map((r) => r.staff_id),
  ).size;

  return (
    <OfficeShell
      activeHref="/compliance"
      title="Compliance"
      crumbs={
        <>
          review queue + expiry radar · <b>{data.queue.length} to review</b> · {blocked} blocked
        </>
      }
      timezone="Viewer: Europe/London (UK)"
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
      <ComplianceScreen data={data} initialTab={tab === 'radar' ? 'radar' : 'review'} />
    </OfficeShell>
  );
}
