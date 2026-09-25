'use client';

import { useEffect, useState, useTransition } from 'react';
import { UK_ZONE, formatDateIn } from '@thc/domain';
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

  // Once the names arrive they are the fresher count — the list row was
  // read when the page loaded. Until then, and if the lookup fails, the row
  // is what the warning is built from: "I don't know" must never be shown
  // as "no upcoming events".
  const count = upcoming?.length ?? venue.events_upcoming;

  return (
    <Modal
      open
      // The wireframe puts the venue's name in the header beside the title.
      // It stays in the body here: `Modal` derives the dialog's accessible
      // name from a STRING title (packages/ui/src/components/Modal.tsx), so
      // a node here would leave the dialog unnamed to a screen reader.
      // Moving it belongs in the design-system PR that gives Modal an
      // aria-label of its own.
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
  return formatDateIn(new Date(`${isoDate}T12:00:00Z`), UK_ZONE, { weekday: 'short' });
}
