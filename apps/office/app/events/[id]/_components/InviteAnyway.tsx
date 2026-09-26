'use client';

import { useState, useTransition } from 'react';
import { Button, Modal } from '@thc/ui';
import { inviteWorker } from '../actions';
import { inviteAnywayPrompt } from '../board-model';

/**
 * "Invite anyway" on an Unavailable row — ADR-0036, docs/18 §1.
 *
 * The worker marked this role section's window unavailable, so auto-assign
 * skips them. The manager may still invite by hand, in the spirit of
 * RULE-17's override, but is asked first. The press is the ordinary manual
 * invite (`office_invite_worker`): every hard gate is re-checked and N5 is
 * queued exactly as from the Potential pool. The calendar is never read on
 * that path — only the machine's own sources are refused `unavailable`.
 *
 * The question is asked in the design system's Modal, as every question on
 * the event board is (ADR-0037 point 8, confirm-dialogs.test) — never `window.confirm`.
 */
export function InviteAnyway({
  eventId,
  shiftId,
  staffId,
  name,
}: {
  eventId: string;
  shiftId: string;
  staffId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const press = () => {
    setAsking(false);
    setError(null);
    startTransition(async () => {
      const result = await inviteWorker(eventId, shiftId, staffId);
      if ('error' in result) setError(result.error);
    });
  };

  return (
    <>
      {error ? <span className="error sm">{error}</span> : null}
      <Button size="sm" tone="outline" disabled={pending} onClick={() => setAsking(true)}>
        Invite anyway
      </Button>

      <Modal
        open={asking}
        title="Invite anyway"
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button tone="primary" disabled={pending} onClick={press}>
              Invite {name}
            </Button>
          </>
        }
      >
        <p>{inviteAnywayPrompt(name)}</p>
      </Modal>
    </>
  );
}
