import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /clients (§9.7) while the directory is read. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/clients" title="Clients">
      <SkeletonScreen label="Loading clients">
        <SkeletonToolbar controls={1} />
        <SkeletonPanel rows={6} lines={3} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
