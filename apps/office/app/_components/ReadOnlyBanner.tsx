'use client';

import { Alert } from '@thc/ui';
import { READ_ONLY_BANNER, isReadOnly } from '../_lib/permissions';
import { useOfficeUser } from './SignedInAs';

/**
 * "Read-only access", above every Back Office screen for a viewer
 * (ADR-0060). The screens still draw their buttons — hiding each one is
 * every screen's own change — and the database refuses whatever a viewer
 * presses (`read_only`), so this says so before they try.
 *
 * Reads the office role from the root layout's context, as the menu does,
 * so it works under the shell whether a server page or a client screen
 * rendered it. Nothing for any other role, or outside the provider.
 */
export function ReadOnlyBanner() {
  const user = useOfficeUser();
  if (!isReadOnly(user?.officeRole)) return null;
  return (
    <Alert tone="purple">
      <b>{READ_ONLY_BANNER.title}.</b> {READ_ONLY_BANNER.body}
    </Alert>
  );
}
