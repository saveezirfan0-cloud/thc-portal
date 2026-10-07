import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /venues while its server reads run: toolbar, then the list. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/venues" title="Venues">
      <SkeletonScreen label="Loading venues">
        <SkeletonToolbar controls={2} />
        <SkeletonPanel rows={6} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
