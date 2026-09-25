import { SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /account (My profile, ADR-0035) while the signed-in user's details are read. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/account" title="My profile">
      <SkeletonScreen label="Loading your profile">
        <div className="grid c2">
          <SkeletonPanel rows={3} lines={2} />
          <SkeletonPanel rows={2} lines={2} />
          <SkeletonPanel rows={3} lines={2} />
          <SkeletonPanel rows={2} lines={2} />
        </div>
      </SkeletonScreen>
    </OfficeShell>
  );
}
