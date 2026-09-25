import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import '../shift-builder.css';

/**
 * The Shift Builder (§3.2) while clients, venues and roles are read: the
 * form's blocks on the left and the summary on the right, as the builder
 * lays them out. Without this the Scheduling list's skeleton showed here.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/events" title="New event">
      <SkeletonScreen label="Loading the Shift Builder">
        <div className="builder">
          <div className="stack">
            <SkeletonPanel rows={3} lines={1} />
            <SkeletonPanel rows={2} lines={1} />
            <SkeletonPanel rows={3} lines={3} />
          </div>
          <div className="side">
            <SkeletonPanel rows={4} lines={1} />
            <Skeleton shape="block" />
          </div>
        </div>
      </SkeletonScreen>
    </OfficeShell>
  );
}
