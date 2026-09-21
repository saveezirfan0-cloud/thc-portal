'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Pill } from '@thc/ui';
import { deleteRole } from './actions';
import type { Role } from './types';

export interface DeleteRoleModalProps {
  role: Role;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * The delete confirmation (§9.8).
 *
 * A role that is on a client's rate card or on a built event cannot be
 * deleted: the rate card would lose its charge rate and dress codes, and a
 * past event's role section is the record of what someone was paid for.
 * The counts come from the list row, so the manager is told what to clear
 * before pressing anything — the database refuses it as well.
 */
export function DeleteRoleModal({ role, onClose, onDeleted }: DeleteRoleModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  const inUse = role.rate_card_count > 0 || role.section_count > 0;

  const confirm = () => {
    setError(null);
    startDeleting(async () => {
      const result = await deleteRole(role.id);
      if (result.ok) onDeleted();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      title="Delete role?"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button tone="danger" solid onClick={confirm} disabled={inUse || deleting}>
            {deleting ? 'Deleting…' : 'Delete role'}
          </Button>
        </>
      }
    >
      <div className="row">
        <Pill tone="coral">{role.name}</Pill>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <p className="sm">
        Are you sure you want to delete <b>{role.name}</b>? This action cannot be undone.
      </p>

      {inUse ? (
        <Alert tone="amber">
          <b>In use — it cannot be deleted yet.</b> {describeUse(role)} Remove it from those rate
          cards first; past events keep their own copy of the rate.
        </Alert>
      ) : (
        <Alert tone="cyan">
          Not on any client&rsquo;s rate card and not used on any event — safe to delete.
        </Alert>
      )}
    </Modal>
  );
}

function describeUse(role: Role): string {
  const parts: string[] = [];
  if (role.rate_card_count > 0) {
    parts.push(
      `${role.rate_card_count} client ${role.rate_card_count === 1 ? 'rate card' : 'rate cards'}`,
    );
  }
  if (role.section_count > 0) {
    parts.push(
      `${role.section_count} event role ${role.section_count === 1 ? 'section' : 'sections'}`,
    );
  }
  return `It is on ${parts.join(' and ')}.`;
}
