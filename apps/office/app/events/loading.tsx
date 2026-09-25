import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';

/** /events (Scheduling, §3.1) while the range is read: the filters, then the list. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/events" title="Scheduling">
      <SkeletonScreen label="Loading events">
        <SkeletonToolbar controls={3} />
        <SkeletonPanel rows={7} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
