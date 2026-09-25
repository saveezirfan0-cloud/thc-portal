'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Input, Modal } from '@thc/ui';
import { addDays } from '../../calendar';
import { duplicateEvent } from '../actions';

/**
 * Duplicate — Scope §3.2: "Multi-day = separate events created via
 * Duplicate (the clone copies the roles, NOT the staff)". Asks for the new
 * date, defaults to the day after, and lands in the builder on the clone.
 */
export function DuplicateEvent({
  eventId,
  title,
  date,
}: {
  eventId: string;
  title: string;
  /** The source event's own date, "YYYY-MM-DD". */
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [toDate, setToDate] = useState(addDays(date, 1));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateEvent(eventId, toDate);
      // On success the action redirects to the clone's builder.
      if (result && 'error' in result) setError(result.error);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Duplicate
      </Button>

      <Modal
        open={open}
        title="Duplicate event"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button tone="primary" disabled={pending || !toDate} onClick={submit}>
              {pending ? 'Copying…' : 'Duplicate'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <p className="sm">
            A new event copies <b>{title}</b>&rsquo;s roles — times, headcount, buffer, rates, dress
            code and each role&rsquo;s Auto-assign switch — onto the date below, with the same
            client, venue, policies and notes. <b>Not the staff</b>: it starts filling from zero,
            and the PO number is left for the new event (§3.2).
          </p>
          <Input
            label="Date of the new event"
            type="date"
            mono
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            hint="The roles keep their UK times on this date. You land in the Shift Builder to rename and adjust it."
          />
        </div>
      </Modal>
    </>
  );
}
