import { SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';

/**
 * A client card (§9.7) while it is read: its four numbered blocks —
 * general info, rate card, qualified staff, events.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/clients" title="Client">
      <SkeletonScreen label="Loading the client card">
        <SkeletonPanel rows={3} lines={2} />
        <SkeletonPanel rows={3} lines={1} />
        <SkeletonPanel rows={4} avatar />
        <SkeletonPanel rows={4} lines={2} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
