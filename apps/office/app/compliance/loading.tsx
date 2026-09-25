import { Skeleton, SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /compliance (§4.1) while the queue and the radar are read: tabs, filters, queue. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/compliance" title="Compliance">
      <SkeletonScreen label="Loading the review queue">
        <div className="row">
          <Skeleton shape="pill" width={140} />
          <Skeleton shape="pill" width={140} />
        </div>
        <SkeletonToolbar controls={2} />
        <SkeletonPanel rows={5} avatar lines={3} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
