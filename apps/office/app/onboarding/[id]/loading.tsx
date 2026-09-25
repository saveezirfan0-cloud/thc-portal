import { Skeleton, SkeletonPanel, SkeletonScreen, SkeletonText } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import '../onboarding.css';

/**
 * A candidate profile (§2.3) while it is read: the header with the selfie,
 * the phase stepper and the phase's panels. Without this the kanban's
 * skeleton showed here.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/onboarding" title="Candidate">
      <SkeletonScreen label="Loading the candidate">
        <div className="cand-head" aria-hidden="true">
          <Skeleton shape="avatar" width={72} height={72} />
          <div className="who">
            <Skeleton width="40%" height="1.6em" />
            <SkeletonText lines={3} />
          </div>
        </div>
        <Skeleton shape="block" height={56} />
        <SkeletonPanel rows={4} lines={2} />
        <SkeletonPanel rows={2} lines={2} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
