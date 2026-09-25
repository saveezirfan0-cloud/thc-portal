import { SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/**
 * /dashboard while its server read is on the way (§9.1): the four KPI
 * tiles, the finance panel and the upcoming events, in the page's order.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/dashboard" title="Dashboard">
      <SkeletonScreen label="Loading the dashboard">
        <SkeletonKpis count={4} />
        <SkeletonPanel rows={2} />
        <SkeletonPanel rows={6} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
