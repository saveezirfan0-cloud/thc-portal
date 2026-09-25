'use client';

import { useState, useTransition } from 'react';
import { Button, Modal } from '@thc/ui';
import { acceptApplication } from '../actions';

/**
 * Accept a Radar application — Scope §3.3, §10.4, §8 N10.
 *
 * The applicant has already said yes by applying, so picking them confirms
 * them directly (`applied → confirmed`) and N10 tells them "You're booked!".
 * Every hard gate and the fill are re-checked in the database at the press;
 * a refusal is shown here in the manager's words.
 *
 * There is no Decline: the scope ends an application only by N10, by N10c
 * when the role fills without it, by the worker withdrawing it, or by the
 * event being cancelled (ADR-0023).
 *
 * The "book them?" question is asked in the design system's Modal, as the
 * payroll warnings in BookingActions are — never `window.confirm`, which
 * blocks the page, ignores the theme and cannot be read by a screen
 * reader as a dialog of this app.
 */
export function ApplicationActions({
  eventId,
  bookingId,
  name,
}: {
  eventId: string;
  bookingId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const accept = () => {
    setAsking(false);
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await acceptApplication(eventId, bookingId);
      if ('error' in result) setError(result.error);
      else if (result.warning) setNote(result.warning);
    });
  };

  return (
    <>
      {error ? (
        <span className="error sm" role="alert">
          {error}
        </span>
      ) : null}
      {note ? <span className="muted sm">{note}</span> : null}
      <Button size="sm" tone="outline" disabled={pending} onClick={() => setAsking(true)}>
        {pending ? 'Accepting…' : 'Accept application'}
      </Button>

      <Modal
        open={asking}
        title="Accept application"
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button tone="primary" disabled={pending} onClick={accept}>
              Book {name}
            </Button>
          </>
        }
      >
        <p>Book {name} onto this shift? They are notified at once (N10).</p>
      </Modal>
    </>
  );
}
