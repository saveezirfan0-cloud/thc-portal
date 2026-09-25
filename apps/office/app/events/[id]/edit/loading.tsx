import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../../_components/OfficeShell';
import '../../shift-builder.css';

/**
 * Editing an event opens the Shift Builder (§3.2), not the board, so it
 * gets the builder's shape rather than the board skeleton above it.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/events" title="Edit event">
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
