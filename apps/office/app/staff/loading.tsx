import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /staff (§9.6) while the directory is read: status filter, search, people. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/staff" title="Staff">
      <SkeletonScreen label="Loading the staff directory">
        <SkeletonToolbar controls={3} />
        <SkeletonPanel rows={8} avatar />
      </SkeletonScreen>
    </OfficeShell>
  );
}
