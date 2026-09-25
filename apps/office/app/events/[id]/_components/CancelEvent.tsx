'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import { cancelEvent } from '../actions';

/**
 * Cancel event — Scope §3.3.
 *
 * The reason is mandatory, the same pattern as a manual Block (§9.6). The
 * modal states what the press actually does, because four of the five
 * consequences are invisible from this screen: the bookings move, the
 * invitations are withdrawn, auto-assign stops, and N12 reaches everyone
 * still attached — including anyone with an open Radar application.
 */
export function CancelEvent({ eventId, affected }: { eventId: string; affected: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelEvent(eventId, reason);
      if ('error' in result) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <Button size="sm" tone="danger" onClick={() => setOpen(true)}>
        Cancel event
      </Button>

      <Modal
        open={open}
        title="Cancel this event"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Keep the event</Button>
            <Button
              tone="danger"
              solid
              disabled={pending || reason.trim().length === 0}
              onClick={submit}
            >
              {pending ? 'Cancelling…' : 'Cancel event'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <Alert tone="amber">
            The event stays on the list and the calendar, greyed out, for the record — it is never
            deleted. {affected} {affected === 1 ? 'person' : 'people'} still attached to it{' '}
            {affected === 1 ? 'is' : 'are'} notified (N12), their bookings move to cancelled, open
            invitations are withdrawn, and auto-assign stops for this event immediately.
          </Alert>
          <Textarea
            label="Reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Client cancelled — event postponed to Q1"
            hint="Required. Shown on the event in the list and the calendar (§3.3)."
          />
          <span className="muted xs">
            A cancellation before the day of the event contributes no margin, revenue or payroll
            (§9.9). If the client cancels on the day, or after anyone has started, the scheduled
            hours are billed and paid in full — that case is handled in the reports, not here.
          </span>
        </div>
      </Modal>
    </>
  );
}
