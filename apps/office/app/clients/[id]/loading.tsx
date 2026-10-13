import { SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';

/**
 * /clients/:id while its server reads run (a dozen of them, in parallel).
 * Without this a click on a client in /clients showed nothing at all until
 * the whole card had been read, and read as a click that did nothing.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/clients" title="Client">
      <SkeletonScreen label="Loading the client">
        <SkeletonKpis count={2} />
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={3} />
      </SkeletonScreen>
    </OfficeShell>
  );
}
