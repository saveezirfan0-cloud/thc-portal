'use client';

import { useState } from 'react';
import { Button, Chip, Modal } from '@thc/ui';

/**
 * The roles a worker holds, under their name on a board row (Potential
 * pool, Unavailable). A worker can hold twenty roles, and listing them all
 * made each row four lines tall; the row now says how many and the list
 * opens in a dialog. The role this section is for is marked in the list.
 *
 * One role (or none recorded) is short enough to show as it was.
 */
export function StaffRoles({
  name,
  roles,
  roleName,
}: {
  name: string;
  roles: string[];
  /** The role section this row sits in. */
  roleName: string;
}) {
  const [open, setOpen] = useState(false);

  if (roles.length <= 1) return <>{roles[0] ?? roleName}</>;

  return (
    <>
      <Button
        tone="link"
        className="roles-more"
        aria-haspopup="dialog"
        aria-label={`${roles.length} roles — show ${name}'s roles`}
        onClick={() => setOpen(true)}
      >
        {roles.length} roles
      </Button>
      <Modal open={open} title={`${name} · ${roles.length} roles`} onClose={() => setOpen(false)}>
        {roles.includes(roleName) ? (
          <p className="muted sm">Highlighted: {roleName}, the role this section is for.</p>
        ) : null}
        <ul className="role-chips" aria-label={`Roles ${name} holds`}>
          {roles.map((role) => (
            <li key={role}>
              <Chip tone={role === roleName ? 'cyan' : 'neutral'}>{role}</Chip>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
