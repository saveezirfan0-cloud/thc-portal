import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /roles while its server reads run: toolbar, then the list. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/roles" title={'Roles & rates'}>
      <SkeletonScreen label="Loading roles">
        <SkeletonToolbar controls={2} />
        <SkeletonPanel rows={6} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
