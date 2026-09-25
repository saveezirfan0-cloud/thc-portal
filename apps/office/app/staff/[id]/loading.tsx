import { Skeleton, SkeletonKpis, SkeletonPanel, SkeletonScreen, SkeletonText } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import './profile.css';

/**
 * A staff profile (§9.6) while its dozen lists are read: the header with
 * the selfie, the KPI tiles, the tab strip and the Overview's panels.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/staff" title="Staff">
      <SkeletonScreen label="Loading the profile">
        <div className="phead" aria-hidden="true">
          <Skeleton shape="avatar" width={72} height={72} />
          <div className="who">
            <Skeleton width="40%" height="1.6em" />
            <SkeletonText lines={3} />
          </div>
        </div>
        <SkeletonKpis count={5} />
        <Skeleton shape="block" />
        <div className="grid c2">
          <SkeletonPanel rows={4} lines={2} />
          <SkeletonPanel rows={4} lines={2} />
        </div>
      </SkeletonScreen>
    </OfficeShell>
  );
}
