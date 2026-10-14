'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Avatar, Button, Modal, Textarea } from '@thc/ui';
import {
  FEEDBACK_SIGNED_OUT,
  FEEDBACK_TEXT_MAX,
  FEEDBACK_TOO_LONG,
  feedbackTextTooLong,
  isRemoved,
  starsHint,
} from '../../rules';
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

const COMMENT_HINT =
  'Optional · free text · seen by The Hospitality Company office, not by the worker.';

/** The count joins the hint only near the limit, so the wireframe's line stays as drawn. */
const COUNT_FROM = FEEDBACK_TEXT_MAX - 200;

export function commentHint(length: number): string {
  if (length < COUNT_FROM) return COMMENT_HINT;
  return `${COMMENT_HINT} ${length.toLocaleString('en-GB')} of ${FEEDBACK_TEXT_MAX.toLocaleString('en-GB')} characters.`;
}

const FAILED = 'Your feedback could not be sent. Check your connection and try again.';

/**
 * Whether a failed send was a lapsed session rather than the connection.
 *
 * With no session the middleware answers the action's POST with a redirect
 * to /login, so the action never runs and its call throws instead of
 * returning. That looks exactly like a dropped connection from here, so the
 * modal asks: `/client/session` (session/route.ts) is behind the same gate,
 * and a redirect from it means signed out. A probe that cannot be made at
 * all is the connection after all.
 */
export async function sessionLapsed(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher('/client/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    return (
      res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 401
    );
  } catch {
    return false;
  }
}

/**
 * The star a key moves the rating to, as the WAI-ARIA APG radio group does
 * (https://www.w3.org/WAI/ARIA/apg/patterns/radio/): Right and Down check
 * the next radio — one star more — and Left and Up the previous — one
 * fewer — wrapping from the last to the first and from the first to the
 * last. With nothing checked yet the group's tab stop is the first star
 * (roving tabindex), so the first Right or Down checks that focused star,
 * 1, rather than skipping it; Left or Up from it wraps to the last, 5.
 * Space checks the focused star (the button's own click). Home and End,
 * which the pattern leaves open, take the first and the last. Null for any
 * other key.
 */
export function starForKey(key: string, rating: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return rating >= 5 || rating < 1 ? 1 : rating + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return rating <= 1 ? 5 : rating - 1;
    case 'Home':
      return 1;
    case 'End':
      return 5;
    default:
      return null;
  }
}

/** The action's "one entry per worker per event" refusal (23505, §11.5). */
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
  // The session lapsed: the comment stays typed, and a sign-in link opens
  // in a new tab so this one keeps it for "Submit feedback" afterwards.
  const [signedOut, setSignedOut] = useState(false);
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
    setSignedOut(false);
    onClose();
  }

  function submit() {
    if (rating === 0) {
      setError('Choose a rating between 1 and 5 stars.');
      return;
    }
    if (feedbackTextTooLong(text)) {
      setError(FEEDBACK_TOO_LONG);
      return;
    }
    setError(null);
    setSignedOut(false);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof leaveFeedback>>;
      try {
        result = await leaveFeedback(eventId, bookingId, rating, text);
      } catch {
        const lapsed = await sessionLapsed();
        setSignedOut(lapsed);
        setError(lapsed ? FEEDBACK_SIGNED_OUT : FAILED);
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
      setSignedOut(result.signedOut === true);
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

      {error ? (
        <Alert tone="coral">
          {error}
          {signedOut ? (
            <>
              {' '}
              <a
                href={`/login?next=${encodeURIComponent(`/client/events/${eventId}`)}`}
                target="_blank"
                rel="noopener"
              >
                Sign in (opens a new tab)
              </a>
            </>
          ) : null}
        </Alert>
      ) : null}

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
              <StarIcon />
            </button>
          ))}
        </div>
        <span className="hint">{starsHint(rating)}</span>
      </fieldset>

      <Textarea
        label="Comment"
        hint={commentHint(text.length)}
        placeholder="What went well, what could be better?"
        rows={4}
        maxLength={FEEDBACK_TEXT_MAX}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        disabled={pending}
      />

      {/* One entry per worker per event, and the portal has no edit or
          delete (§11.5): said here, before the button, not after. */}
      <div className="note sm fb-final">
        Once submitted, feedback cannot be edited or withdrawn from the portal. If something needs
        correcting, contact the office.
      </div>
    </Modal>
  );
}

/**
 * One star of the picker. A shape, not a glyph, so the two states differ in
 * form as well as colour: an outline in --muted until chosen, then filled
 * in the amber (client-portal.css .star). The same ★ in two colours read as
 * five identical stars in light mode, where --muted and the amber ink are
 * barely 1.2:1 apart.
 */
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.8l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.58-4.46 6.33-.92z" />
    </svg>
  );
}
