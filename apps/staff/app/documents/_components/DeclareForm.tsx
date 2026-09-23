'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Modal, Textarea } from '@thc/ui';
import { CONVICTION_DETAILS_MAX } from '@thc/domain';
import { declareConviction } from '../actions';

/**
 * Declare a criminal conviction — §10.7, `wireframes/staff/documents.html`
 * ("Declaration form" and "Confirmation step").
 *
 * A required details field, an optional date, a plainly-worded notice above
 * the submit button, and a confirmation step "because the consequences are
 * real". The released-shift count in the confirmation is the real one: the
 * worker's confirmed bookings that have not started, which is exactly what
 * `block_worker()` releases.
 *
 * After submit the worker lands back on Documents, which is now locked to
 * itself with §10.7's "Thanks for telling us" copy. What they typed is not
 * shown back anywhere — the form clears and the tab never receives it.
 */
export function DeclareForm({ futureShifts, today }: { futureShifts: number; today: string }) {
  const router = useRouter();
  const [details, setDetails] = useState('');
  const [date, setDate] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ready = details.trim().length > 0 && details.length <= CONVICTION_DETAILS_MAX;

  function confirm() {
    setError(null);
    start(async () => {
      const result = await declareConviction(details, date || null);
      setAsking(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDetails('');
      router.replace('/documents');
      router.refresh();
    });
  }

  return (
    <div className="docs-form">
      <p className="sm muted">
        Use this to tell us about an <b>unspent</b> criminal conviction that has happened since you
        joined. Your agreement requires it — you’re not being penalised for telling us.
      </p>

      <Textarea
        label={
          <>
            Details <span className="coral">*</span>
          </>
        }
        value={details}
        maxLength={CONVICTION_DETAILS_MAX}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="What the conviction was for, the court and the outcome."
        style={{ minHeight: 96 }}
        hint="Read only by admin users in the office. Never shown to clients, never in reports, and not shown back to you on this screen after you submit."
      />

      <Input
        label="Date of conviction · optional"
        type="date"
        value={date}
        max={today}
        onChange={(event) => setDate(event.target.value)}
      />

      <div className="notice">
        <div className="strong">What happens when you submit</div>
        <div>
          • Your upcoming shifts are <b>paused</b> while the office reviews your declaration, and
          any open invitations are withdrawn.
        </div>
        <div>• A shift you’re already working today isn’t affected.</div>
        <div>
          • The office will be in touch. If the declaration is accepted, your shifts open again
          automatically.
        </div>
        <div className="xs muted">
          Declaring is a requirement of your agreement with The Hospitality Company, not a penalty.
        </div>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Button
        tone="primary"
        size="lg"
        block
        disabled={!ready || pending}
        onClick={() => setAsking(true)}
      >
        Submit declaration
      </Button>
      {!ready ? (
        <div className="xs muted" style={{ textAlign: 'center' }}>
          Enter the details to submit
        </div>
      ) : null}

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Are you sure?"
        footer={
          <>
            <Button onClick={() => setAsking(false)} disabled={pending}>
              Go back
            </Button>
            <Button tone="danger" onClick={confirm} disabled={pending}>
              {pending ? 'Submitting…' : 'Yes, submit'}
            </Button>
          </>
        }
      >
        <p className="muted">{consequence(futureShifts)}</p>
        <p className="xs muted">The office will review your declaration and contact you.</p>
      </Modal>
    </div>
  );
}

/** The confirmation's first sentence, with the real number of shifts it releases. */
export function consequence(futureShifts: number): string {
  const shifts =
    futureShifts === 0
      ? 'You have no booked shifts to release'
      : `${futureShifts} booked ${futureShifts === 1 ? 'shift' : 'shifts'} will be released and offered to other staff`;
  return `Submitting pauses your upcoming shifts straight away — ${shifts}. This can’t be undone from the app.`;
}
