'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, Avatar, Button, Modal, Textarea } from '@thc/ui';
import { REQUEST_COPY, REQUEST_NOTE_MAX, requestNoteTooLong } from '../../rules';
import { requestAgain } from './actions';
import { sessionLapsed } from './FeedbackModal';

/**
 * ADR-0135 §2 · "Request this person again" — the small dialog behind the
 * button on a finished event's line-up.
 *
 * It sends ONE message to THC (`client_request_worker`, the CP1 office
 * email) with an optional note of at most 500 characters. It books nobody
 * and changes nothing on the event, and the dialog says so before the
 * button. After a send the dialog stays open on one sentence — "Sent to
 * THC…" or, when THC already had an open request for the same person,
 * "Already requested — THC has it." — with focus on it, and the row reads
 * "✓ Requested" once it is closed (`onSent`).
 *
 * While a send is in flight it cannot be dismissed, as the feedback popup.
 */
export function RequestModal({
  eventId,
  bookingId,
  personName,
  photo,
  role,
  eventTitle,
  eventDate,
  onClose,
  onSent,
}: {
  eventId: string;
  bookingId: string;
  personName: string;
  photo?: string;
  role: string;
  eventTitle: string;
  eventDate: string;
  onClose: () => void;
  /** The request is with THC (new or already open): the row becomes "✓ Requested". */
  onSent: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const doneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  function close() {
    if (pending) return;
    onClose();
  }

  function send() {
    if (requestNoteTooLong(note)) {
      setError(REQUEST_COPY.tooLong);
      return;
    }
    setError(null);
    setSignedOut(false);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof requestAgain>>;
      try {
        result = await requestAgain(eventId, bookingId, note);
      } catch {
        const lapsed = await sessionLapsed();
        setSignedOut(lapsed);
        setError(lapsed ? REQUEST_COPY.signedOut : REQUEST_COPY.failed);
        return;
      }
      if (result.ok) {
        setDone(result.already ? REQUEST_COPY.already : REQUEST_COPY.sent);
        onSent();
        return;
      }
      setSignedOut(result.signedOut === true);
      setError(result.error);
    });
  }

  return (
    <Modal
      open
      title={`Request again · ${personName}`}
      onClose={close}
      dismissible={!pending}
      footer={
        done ? (
          <Button tone="primary" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button tone="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button tone="primary" onClick={send} disabled={pending}>
              {pending ? 'Sending…' : 'Send request to THC'}
            </Button>
          </>
        )
      }
    >
      <div className="fb-who">
        <Avatar name={personName} src={photo} silhouette />
        <div className="xs muted">
          {role} · {eventTitle} · {eventDate}
        </div>
      </div>

      {done ? (
        <div ref={doneRef} tabIndex={-1} role="status" className="req-done">
          <Alert tone="green">{done}</Alert>
        </div>
      ) : (
        <>
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
          <p className="sm req-explain">{REQUEST_COPY.explain}</p>
          <Textarea
            label="Note to THC"
            hint={`${REQUEST_COPY.hint} ${note.length} of ${REQUEST_NOTE_MAX}.`}
            placeholder="What made them a good fit? Which events would you like them for?"
            rows={4}
            maxLength={REQUEST_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            disabled={pending}
          />
        </>
      )}
    </Modal>
  );
}
