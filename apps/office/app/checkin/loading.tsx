import { Skeleton, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import './checkin.css';

/**
 * The live monitor (§9.5) while today's board is read: the event strip, the
 * monitor and the violation log.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/checkin" title="Check In / Out">
      <SkeletonScreen label="Loading the live monitor">
        <div className="evstrip" aria-hidden="true">
          <Skeleton shape="tile" height={96} />
          <Skeleton shape="tile" height={96} />
          <Skeleton shape="tile" height={96} />
        </div>
        <SkeletonPanel rows={6} avatar />
        <SkeletonPanel rows={2} avatar />
      </SkeletonScreen>
    </OfficeShell>
  );
}
