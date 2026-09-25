import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /activity (ADR-0035) while a page of the audit log is read. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/activity" title="Activity log">
      <SkeletonScreen label="Loading the activity log">
        <SkeletonToolbar controls={3} />
        <SkeletonPanel rows={8} lines={2} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
