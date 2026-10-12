'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Avatar, Button, Modal, Textarea } from '@thc/ui';
import { isRemoved, starsHint } from '../../rules';
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
 *
 * While a submission is in flight the popup cannot be dismissed (Esc, the
 * backdrop and × do nothing): closing it then would leave the customer not
 * knowing whether the entry was saved. A refused or failed call says so in
 * plain words; "already left" — a second tab, a double tap — is not an
 * error to fix but a row to re-read, so the popup closes and the page
 * refreshes to show "✓ Feedback sent".
 */
const STARS = [1, 2, 3, 4, 5] as const;

/** The comment's ceiling, and where the counter starts showing. */
export const COMMENT_MAX = 2000;
const COUNTER_FROM = 1800;

const FAILED = 'Your feedback could not be sent. Check your connection and try again.';

/** The action's "one entry per worker per event" refusal (23505, §11.5). */
/**
 * The star a key moves the rating to, as a radio group does (WAI-ARIA APG):
 * Right/Up one more, Left/Down one fewer, Home the first, End the last,
 * stopping at the ends. Null for any other key. From no rating yet, Right
 * and Up pick 1 star and Left and Down pick 1 too — the first a keyboard
 * can reach — rather than jumping to 5.
 */
export function starForKey(key: string, rating: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(5, Math.max(1, rating + 1));
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(1, rating - 1);
    case 'Home':
      return 1;
    case 'End':
      return 5;
    default:
      return null;
  }
}

export function isAlreadyLeft(result: { error?: string; code?: string | null }): boolean {
  return result.code === '23505' || /already been left/i.test(result.error ?? '');
}

export function FeedbackModal({
  open,
  eventId,
  bookingId,
  personName,
  photo,
  role,
  eventTitle,
  eventDate,
  onClose,
}: {
  open: boolean;
  eventId: string;
  bookingId: string;
  personName: string;
  /** The worker's signed selfie URL, when there is one. */
  photo?: string;
  /** The subtitle: "Waiting Staff · Gala Dinner · Fri 19 Sep 2026". */
  role: string;
  eventTitle: string;
  eventDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // One tab stop for the group (roving tabindex): the chosen star, or the
  // first before a choice; the arrows, Home and End move and choose.
  function onStarKey(e: KeyboardEvent<HTMLDivElement>) {
    if (pending) return;
    const next = starForKey(e.key, rating);
    if (next === null) return;
    e.preventDefault();
    setRating(next);
    starRefs.current[next - 1]?.focus();
  }

  function close() {
    if (pending) return;
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
      let result: Awaited<ReturnType<typeof leaveFeedback>>;
      try {
        result = await leaveFeedback(eventId, bookingId, rating, text);
      } catch {
        setError(FAILED);
        return;
      }
      if (result.ok) {
        setRating(0);
        setText('');
        onClose();
        return;
      }
      if (isAlreadyLeft(result as { error?: string; code?: string | null })) {
        setRating(0);
        setText('');
        onClose();
        router.refresh();
        return;
      }
      setError(result.error);
    });
  }

  return (
    <Modal
      open={open}
      title={`Feedback · ${personName}`}
      onClose={close}
      dismissible={!pending}
      footer={
        <>
          <Button tone="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button tone="primary" onClick={submit} disabled={pending}>
            {pending ? 'Submitting…' : 'Submit feedback'}
          </Button>
        </>
      }
    >
      {/* The face first (event.html:215): the customer rates the person
          they recognise, not a name on a list (§11.1). */}
      <div className="fb-who">
        <Avatar
          name={personName}
          src={photo}
          deleted={isRemoved({ name: personName })}
          silhouette
        />
        <div className="xs muted">
          {role} · {eventTitle} · {eventDate}
        </div>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <fieldset className="stars-field">
        <legend className="label">Rating</legend>
        <div
          className="stars-row"
          role="radiogroup"
          aria-label="Rating out of five"
          aria-required="true"
          onKeyDown={onStarKey}
        >
          {STARS.map((n) => (
            <button
              key={n}
              ref={(el) => {
                starRefs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={rating === n}
              tabIndex={n === (rating || 1) ? 0 : -1}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              className={n <= rating ? 'star on' : 'star'}
              onClick={() => setRating(n)}
              disabled={pending}
            >
              ★
            </button>
          ))}
        </div>
        <span className="hint">{starsHint(rating)}</span>
      </fieldset>

      <Textarea
        label="Comment"
        hint="Optional · free text · seen by The Hospitality Company office, not by the worker."
        placeholder="What went well, what could be better?"
        rows={4}
        maxLength={COMMENT_MAX}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        disabled={pending}
      />
      {text.length >= COUNTER_FROM ? (
        <div className="fb-count xs muted" aria-live="polite">
          {text.length} / {COMMENT_MAX}
        </div>
      ) : null}

      {/* One entry per worker per event, and the portal has no edit or
          delete (§11.5): said here, before the button, not after. */}
      <div className="note sm fb-final">
        Once submitted, feedback cannot be edited or withdrawn from the portal. If something needs
        correcting, contact the office.
      </div>
    </Modal>
  );
}
