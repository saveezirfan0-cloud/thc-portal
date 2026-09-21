'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Modal, Textarea } from '@thc/ui';
import { leaveFeedback } from './actions';

/**
 * §11.2 · the feedback popup — stars plus a comment.
 *
 * One entry per worker per event. The customer cannot edit or delete it
 * afterwards and cannot see the office's own entry on the same worker
 * (§9.10), so the modal closes on success and the row's button becomes
 * "✓ Feedback sent" when the page re-reads.
 *
 * The comment is optional: §11.2 asks for "stars + comment", and a customer
 * who wants to record five stars and nothing else should not have to invent
 * a sentence.
 */
const STARS = [1, 2, 3, 4, 5] as const;

export function FeedbackModal({
  open,
  eventId,
  bookingId,
  personName,
  onClose,
}: {
  open: boolean;
  eventId: string;
  bookingId: string;
  personName: string;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setRating(0);
    setText('');
    setError(null);
    onClose();
  }

  function submit() {
    if (rating === 0) {
      setError('Choose a rating between 1 and 5 stars.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await leaveFeedback(eventId, bookingId, rating, text);
      if (result.ok) close();
      else setError(result.error);
    });
  }

  return (
    <Modal
      open={open}
      title={`Feedback · ${personName}`}
      onClose={close}
      footer={
        <>
          <Button tone="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button tone="primary" onClick={submit} disabled={pending}>
            {pending ? 'Sending…' : 'Send feedback'}
          </Button>
        </>
      }
    >
      {error ? <Alert tone="coral">{error}</Alert> : null}

      <fieldset className="stars-field">
        <legend className="label">Rating</legend>
        <div className="stars-row" role="radiogroup" aria-label="Rating out of five">
          {STARS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              className={n <= rating ? 'star on' : 'star'}
              onClick={() => setRating(n)}
              disabled={pending}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>

      <Textarea
        label="Comment"
        hint="Optional. This goes to The Hospitality Company, not to the worker."
        rows={4}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        disabled={pending}
      />
    </Modal>
  );
}
