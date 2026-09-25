import { SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';

/**
 * The event board (§3.3) while it is computed — the pool is ranked fresh on
 * every open, so this can take a moment: the event header, then one panel
 * per role section with its people.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/events" title="Event board">
      <SkeletonScreen label="Loading the event board">
        <SkeletonPanel rows={2} lines={3} />
        <SkeletonPanel rows={4} avatar />
        <SkeletonPanel rows={3} avatar />
      </SkeletonScreen>
    </OfficeShell>
  );
}
