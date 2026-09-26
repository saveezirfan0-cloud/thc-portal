import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /users (ADR-0049) while the logins are read: filters, then the list. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/users" title="Users & access">
      <SkeletonScreen label="Loading users">
        <SkeletonToolbar controls={2} />
        <SkeletonPanel rows={6} avatar />
      </SkeletonScreen>
    </OfficeShell>
  );
}
