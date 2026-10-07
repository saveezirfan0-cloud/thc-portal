import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/**
 * /onboarding while the pipeline is read: the menu answers the click at
 * once, then the toolbar and a few columns of cards stand where they land.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/onboarding" title="Onboarding">
      <SkeletonScreen label="Loading the onboarding pipeline">
        <SkeletonToolbar controls={3} />
        <SkeletonPanel rows={5} avatar />
      </SkeletonScreen>
    </OfficeShell>
  );
}
