'use client';

import { useEffect, useState, useTransition } from 'react';
import { Alert, Button, Modal, Pill } from '@thc/ui';
import { deleteVenue, loadUpcomingEvents } from './actions';
import type { UpcomingEvent, Venue } from './types';

export interface DeleteVenueModalProps {
  venue: Venue;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * The delete confirmation (§9.11) — a modal, never an inline action.
 *
 * It states the number of upcoming events that use the venue and names
 * them, and it explains what deleting does and does not do: the venue
 * leaves the picker when new events are built, while events already in the
 * diary keep the address and radius they copied at build time. That is why
 * the delete is soft.
 */
export function DeleteVenueModal({ venue, onClose, onDeleted }: DeleteVenueModalProps) {
  const [upcoming, setUpcoming] = useState<UpcomingEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  // The count travels with the list row; the names are fetched only when a
  // manager actually opens the confirmation.
  useEffect(() => {
    let live = true;
    void loadUpcomingEvents(venue.id).then((events) => {
      if (live) setUpcoming(events);
    });
    return () => {
      live = false;
    };
  }, [venue.id]);

  const confirm = () => {
    setError(null);
    startDeleting(async () => {
      const result = await deleteVenue(venue.id);
      if (result.ok) onDeleted();
      else setError(result.message);
    });
  };

  // The count comes from the list row, which read it from the same view.
  // The names are a lookup that may still be in flight, or may be short if
  // the manager's own policy hides an event from them — neither is a reason
  // to stop warning about the number.
  const count = venue.events_upcoming;

  return (
    <Modal
      open
      title="Delete venue?"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button tone="danger" solid onClick={confirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete venue'}
          </Button>
        </>
      }
    >
      <div className="row">
        <Pill tone="coral">{venue.name}</Pill>
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <p>
        Are you sure you want to delete this venue? <b>This action cannot be undone.</b>
      </p>

      {count > 0 ? (
        <Alert tone="amber">
          <b>
            This venue is used on {count} upcoming {count === 1 ? 'event' : 'events'}
          </b>
          {upcoming && upcoming.length > 0 ? <> — {upcoming.map(describe).join(', ')}.</> : null}
        </Alert>
      ) : null}

      <div className="sm muted">
        Deleting removes it from venue selection when creating new events. Existing events keep
        their own address and geofence radius exactly as they were at the time they were built —
        deleting a venue never breaks a past or already-scheduled event (§9.11).
      </div>
    </Modal>
  );
}

/** "Gala Dinner (Fri 19 Sep)" — the wireframe's wording for a named event. */
function describe(event: UpcomingEvent): string {
  return `${event.title} (${formatEventDate(event.event_date)})`;
}

/**
 * Event dates are calendar dates, and §1.8 evaluates dates in UK time, so
 * the string is parsed as a UK wall-clock date rather than as an instant.
 */
function formatEventDate(isoDate: string): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  }).format(new Date(`${isoDate}T12:00:00Z`));
  return formatted.replace(',', '');
}
