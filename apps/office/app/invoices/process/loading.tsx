import { SkeletonPanel, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';

/** /invoices/process (and a job) while the server reads run. */
export default function Loading() {
  return (
    <OfficeShell activeHref="/invoices" title="Process timesheet">
      <SkeletonScreen label="Loading timesheet">
        <SkeletonToolbar controls={3} />
        <SkeletonPanel rows={6} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
