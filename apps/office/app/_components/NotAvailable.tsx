import Link from 'next/link';
import { EmptyState, Panel } from '@thc/ui';
import {
  OFFICE_ROLE_LABEL,
  type OfficePermission,
  type OfficeRole,
  PERMISSION_NEEDS,
} from '../_lib/permissions';
import { OfficeShell } from './OfficeShell';

/**
 * What a Back Office section shows when the signed-in office role cannot
 * use it and it was opened by URL (ADR-0050). The menu already leaves it
 * out; this is the page's own answer, so a bookmark or a shared link lands
 * on a sentence rather than on a database error. It is not the protection
 * — the database refuses the reads and writes regardless.
 */
export function NotAvailable({
  activeHref,
  title,
  role,
  needs,
}: {
  activeHref: string;
  title: string;
  role: OfficeRole;
  needs: OfficePermission;
}) {
  return (
    <OfficeShell activeHref={activeHref} title={title}>
      <Panel>
        <EmptyState>
          <p className="strong">Not available for your role</p>
          <p className="sm muted">
            You are signed in as a {OFFICE_ROLE_LABEL[role]}. {PERMISSION_NEEDS[needs]} If you need
            it, ask an owner to change your role on Users &amp; access.
          </p>
          <p className="sm">
            <Link href="/dashboard">Back to the Dashboard</Link>
          </p>
        </EmptyState>
      </Panel>
    </OfficeShell>
  );
}
