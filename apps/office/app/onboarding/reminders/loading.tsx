import { Skeleton, SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';

/** /onboarding/reminders (ADR-0193) while the numbers are read. */
export default function Loading() {
  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Reminder emails"
      crumbs={<>Onboarding / Reminder emails</>}
    >
      <SkeletonScreen label="Loading the reminder emails">
        <SkeletonKpis count={4} />
        <SkeletonPanel rows={3} lines={1} />
        <Skeleton shape="card" />
      </SkeletonScreen>
    </OfficeShell>
  );
}
