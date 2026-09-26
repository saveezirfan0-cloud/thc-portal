'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@thc/ui';
import { deleteFeedback, updateOfficeFeedback, workerEvents } from '../actions';
import { eventOptionLabel, quoted, uniqueEvents, validateDraft } from '../view-model';
import type { EventOption, FeedbackEntry } from '../types';
import { StarPicker, Stars } from './Stars';

/**
 * Edit an office entry (§9.10): stars, the event it is tied to, and the
 * comment. The worker, the author and the date stay — the database holds
 * them fixed — and the row gains an "edited" line. Editing is also how the
 * office redacts a name from an office comment after a GDPR removal (§1.7).
 */
export function EditFeedbackModal({
  entry,
  events: known,
  onClose,
}: {
  entry: FeedbackEntry;
  /** The profile already has the worker's events; /feedback fetches them. */
  events?: EventOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(entry.rating);
  const [text, setText] = useState(entry.text ?? '');
  const [eventId, setEventId] = useState(entry.event_id ?? '');
  const [events, setEvents] = useState<EventOption[]>(uniqueEvents(known ?? []));
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (known) return;
    let live = true;
    void workerEvents(entry.staff_id).then((rows) => {
      if (live) setEvents(uniqueEvents(rows));
    });
    return () => {
      live = false;
    };
  }, [entry.staff_id, known]);

  // The entry's own event stays selectable even if the list has not
  // loaded yet, so opening the dialog never silently unties it.
  const options =
    entry.event_id && !events.some((e) => e.id === entry.event_id)
      ? [
          {
            id: entry.event_id,
            title: entry.event_title ?? 'This event',
            date: entry.event_date ?? '',
            client: entry.client_name,
          },
          ...events,
        ]
      : events;

  const save = () => {
    const draft = { staffId: entry.staff_id, rating, text, eventId };
    const invalid = validateDraft(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(null);
    start(async () => {
      const result = await updateOfficeFeedback(entry.id, draft);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open
      title={`Edit feedback · ${entry.staff_name}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button tone="primary" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        <div className="field">
          <span className="label">Stars</span>
          <StarPicker value={rating} onChange={setRating} disabled={pending} showCount />
        </div>
        <div className="field">
          <label className="label" htmlFor={`edit-event-${entry.id}`}>
            Event <span className="muted">· optional</span>
          </label>
          <select
            id={`edit-event-${entry.id}`}
            className="input"
            value={eventId}
            disabled={pending}
            onChange={(event) => setEventId(event.target.value)}
          >
            <option value="">Not tied to an event</option>
            {options.map((event) => (
              <option key={event.id} value={event.id}>
                {eventOptionLabel(event)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={`edit-text-${entry.id}`}>
            Comment
          </label>
          <textarea
            id={`edit-text-${entry.id}`}
            className="input"
            rows={4}
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="hint">
            The author ({entry.author_name ?? 'unknown'}) and the date stay as they are. The change
            to the stars counts toward the rating straight away.
          </span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Delete an entry. For an office entry that is simply §9.10's Delete; for
 * a client entry it exists only after the worker's GDPR removal, to redact
 * a name if asked (§1.7) — and the dialog says which of the two it is.
 */
export function DeleteFeedbackModal({
  entry,
  onClose,
}: {
  entry: FeedbackEntry;
  onClose: () => void;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    setProblem(null);
    start(async () => {
      const result = await deleteFeedback(entry.id);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open
      title="Delete feedback"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button tone="danger" onClick={remove} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        <div className="row">
          <Stars rating={entry.rating} />
          <b>{entry.staff_name}</b>
        </div>
        {quoted(entry.text) ? <div className="sm">{quoted(entry.text)}</div> : null}
        {entry.author_kind === 'client' ? (
          <Alert tone="amber">
            Client feedback is otherwise read-only. It can be deleted here only because the worker
            has been removed — use this to redact a name if asked. This cannot be undone.
          </Alert>
        ) : (
          <p className="sm muted">
            The entry is removed from the worker&rsquo;s feedback and{' '}
            {entry.counts_toward_rating ? 'no longer counts toward their rating' : 'from the list'}.
            This cannot be undone.
          </p>
        )}
      </div>
    </Modal>
  );
}
