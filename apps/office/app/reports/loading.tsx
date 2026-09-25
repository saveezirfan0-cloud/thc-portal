import { Skeleton, SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/**
 * /reports (§9.9) while a report is computed: the three tabs, the period
 * controls, the headline tiles and the breakdown.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/reports" title="Reports">
      <SkeletonScreen label="Loading the report">
        <div className="row">
          <Skeleton shape="pill" width={140} />
          <Skeleton shape="pill" width={140} />
          <Skeleton shape="pill" width={160} />
        </div>
        <Skeleton shape="block" width="min(100%, 420px)" />
        <SkeletonKpis count={3} />
        <SkeletonPanel rows={5} lines={1} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
