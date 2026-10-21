'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Modal, Textarea } from '@thc/ui';
import { CONVICTION_DETAILS_MAX } from '@thc/domain';
import { updateDeclaration } from '../declaration-actions';
import { consequence } from './DeclareForm';

/**
 * Update your declaration (ADR-0180) — where a worker or a candidate answers
 * the office: it asked for more details (its message is shown, word for
 * word), or it could not accept the declaration as it was.
 *
 * The same fields and checks as the original declaration: a required
 * details field and an optional date. What was declared before is NOT shown
 * back — the declaration's text is never displayed on a shared screen
 * (§10.7 step 5) — and neither is anything the office noted for itself.
 * Sending it adds a new declaration; the earlier one is kept on record.
 *
 * A compliant worker's update pauses their upcoming shifts while it is
 * reviewed, as any declaration from the app does, so for them the button
 * asks first, with the real number of shifts it releases.
 */
export function UpdateDeclarationForm({
  status,
  message,
  pausesShifts,
  futureShifts = null,
  today,
  after,
}: {
  status: 'details_requested' | 'rejected';
  message: string | null;
  pausesShifts: boolean;
  /** Confirmed shifts not yet started, when they could be read. */
  futureShifts?: number | null;
  today: string;
  /** Where to go once it is sent. */
  after: string;
}) {
  const router = useRouter();
  const [details, setDetails] = useState('');
  const [date, setDate] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const ready = details.trim().length > 0 && details.length <= CONVICTION_DETAILS_MAX;

  function send() {
    setError(null);
    start(async () => {
      const result = await updateDeclaration(details, date || null);
      setAsking(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDetails('');
      setSent(true);
      router.replace(after);
      router.refresh();
    });
  }

  if (sent) {
    return (
      <Alert tone="cyan">
        <b>Thanks — your updated declaration is with the office.</b> We’ll be in touch.
      </Alert>
    );
  }

  return (
    <div className="docs-form" id="declaration">
      {status === 'details_requested' ? (
        <Alert tone="amber">
          <b>The office needs a bit more detail about your declaration.</b>
          {message ? (
            <>
              <br />
              <span className="sm">“{message}”</span>
            </>
          ) : null}
        </Alert>
      ) : (
        <Alert tone="amber">
          <b>The office couldn’t accept your declaration as it was.</b>
          <br />
          <span className="sm">
            Please send it again with the full details: what the conviction was for, when, and the
            outcome.
          </span>
        </Alert>
      )}

      <Textarea
        label={
          <>
            Details <span className="coral">*</span>
          </>
        }
        value={details}
        maxLength={CONVICTION_DETAILS_MAX}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="What the conviction was for, the date, the court and the sentence."
        style={{ minHeight: 96 }}
        hint="Write the whole declaration again, with what the office asked for. Read only by admin users in the office, never shown to clients, and not shown back to you on this screen after you send it."
      />

      <Input
        label="Date of conviction · optional"
        type="date"
        value={date}
        max={today}
        onChange={(event) => setDate(event.target.value)}
      />

      <div className="notice">
        <div className="strong">What happens when you send it</div>
        <div>• It goes to the office for review. Your earlier declaration is kept on record.</div>
        {pausesShifts ? (
          <>
            <div>
              • Your upcoming shifts are <b>paused</b> while the office reviews it, and any open
              invitations are withdrawn. A shift you’re already working today isn’t affected.
            </div>
            <div>• If the office accepts it, your shifts open again automatically.</div>
          </>
        ) : (
          <div>• The office will be in touch once they have looked at it.</div>
        )}
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
        onClick={() => (pausesShifts ? setAsking(true) : send())}
      >
        {pending ? 'Sending…' : 'Send updated declaration'}
      </Button>
      {!ready ? (
        <div className="xs muted" style={{ textAlign: 'center' }}>
          Enter the details to send
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
            <Button tone="danger" onClick={send} disabled={pending}>
              {pending ? 'Sending…' : 'Yes, send'}
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
