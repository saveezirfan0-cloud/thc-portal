'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Panel, Pill } from '@thc/ui';
import { UK_ZONE, formatDateTimeIn, formatTimeIn } from '@thc/domain';
import { EventWindow } from '../../EventWindow';
import { ukDateLong, ukDateShort } from '../../format';
import { feedbackOpen, fillOf, groupByRole, headerDocuments, statusTone } from '../../rules';
import type { DocumentKind, LineupRow, PortalEvent, RoleSection } from '../../rules';
import { FeedbackModal } from './FeedbackModal';

/**
 * §11.2 · the event page.
 *
 * ONLY the confirmed staff, grouped by role, each with photo · name · role.
 * The selection process — Invited · Potential pool · Unavailable · the Auto
 * Invite toggle — stays internal to THC and has no representation here at
 * all: `client_lineup_v` returns confirmed and worked bookings only, so
 * there is no unconfirmed row for this screen to leak even by accident.
 *
 * Read-only, apart from the one write the scope carves out: feedback.
 */
const STATUS_LABEL: Record<PortalEvent['status'], string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** One row of `client_event_documents_v`, as the page hands it over. */
export interface IssuedDocument {
  kind: DocumentKind;
  /** When the office generated this copy (`issued_at`), ISO. */
  issuedAt: string;
}

export function EventScreen({
  event,
  sections,
  lineup,
  photos,
  now,
  documents = [],
}: {
  event: PortalEvent;
  sections: RoleSection[];
  lineup: LineupRow[];
  photos: Record<string, string>;
  now: string;
  /** Which §11.3 PDFs the office has produced for this event. */
  documents?: IssuedDocument[];
}) {
  const [rating, setRating] = useState<LineupRow | null>(null);

  const at = useMemo(() => new Date(now), [now]);
  const groups = useMemo(() => groupByRole(lineup, sections), [lineup, sections]);
  const fill = useMemo(() => fillOf(sections), [sections]);
  const open = feedbackOpen(event, at);
  const cancelled = event.status === 'cancelled';
  const completed = event.status === 'completed';
  const downloads = headerDocuments(
    event.status,
    documents.map((d) => d.kind),
  );
  const timesheet = completed ? documents.find((d) => d.kind === 'signout') : undefined;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="ehead">
        <div className="row wrap">
          <Link className="sm" href="/client">
            ← Your events
          </Link>
        </div>

        <div className="row wrap top">
          <div>
            <h1>{event.title}</h1>
            <div className="muted sm">
              {event.venueName} · {event.venueAddress}
            </div>
          </div>
          <Pill tone={statusTone(event.status)} large dot={event.status === 'ongoing'}>
            {STATUS_LABEL[event.status]}
          </Pill>
          {event.poNumber ? <Pill large>PO Number · {event.poNumber}</Pill> : null}

          <div className="ml-auto row">
            {/* §11.2's header action: the §11.3 PDF, once the office has
                produced one. Download only; sending is the office's (§11.4).
                Completed: the signed timesheet takes the primary slot and the
                allocation sheet stays beside it as history (event.html:247). */}
            {downloads.map(({ kind, available }) => {
              const label =
                kind === 'signout'
                  ? '↓ Download Signed Timesheet'
                  : completed
                    ? '↓ Allocation Sheet'
                    : '↓ Download Allocation Sheet';
              const primary = kind === 'signout' || !completed;
              return available ? (
                <a
                  key={kind}
                  className={primary ? 'btn primary' : 'btn'}
                  href={`/client/events/${event.id}/document?kind=${kind}`}
                >
                  {label}
                </a>
              ) : (
                <Button
                  key={kind}
                  tone={primary ? 'primary' : 'default'}
                  disabled
                  title="THC has not issued this document yet"
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="meta">
          <div>
            <div className="k">Date</div>
            <div className="v">{ukDateLong(event.startsAt)}</div>
          </div>
          <div>
            <div className="k">Event window</div>
            <div className="v">
              <EventWindow startsAt={event.startsAt} endsAt={event.endsAt} />
            </div>
          </div>
          <div>
            <div className="k">{completed ? 'Staff on the day' : 'Confirmed staff'}</div>
            <div className="v">
              <b>{fill.confirmed}</b> of {fill.headcount} ·{' '}
              {groups.length === 1 ? '1 role' : `${groups.length} roles`}
            </div>
          </div>
          {timesheet ? (
            <div>
              <div className="k">Timesheet</div>
              <div className="v">
                {/* An audit stamp: UK-only, never dual (§1.8). The final copy
                    goes to the contact emails on the client card (§11.4);
                    the view carries no recipient count, so none is claimed. */}
                Sign-out timesheet generated{' '}
                {formatDateTimeIn(new Date(timesheet.issuedAt), UK_ZONE)}
                <span className="sub">by email to the contacts on your client card (§11.4)</span>
              </div>
            </div>
          ) : null}
          <div>
            <div className="k">Your on-site contact</div>
            <div className="v">
              {event.onsiteContact ?? '—'}
              <span className="sub">as given on your client card</span>
            </div>
          </div>
        </div>

        {cancelled ? (
          <Alert tone="neutral">
            This event was cancelled, so there is no confirmed line-up to show.
          </Alert>
        ) : open ? (
          <Alert tone="green">
            The event has started — you can now leave feedback on each member of staff. One entry
            per person per event.
          </Alert>
        ) : (
          <Alert tone="cyan">
            Feedback opens once the event has started — from{' '}
            {formatTimeIn(new Date(event.startsAt), UK_ZONE)} UK time on the day. Until then the
            &ldquo;Leave feedback&rdquo; buttons are disabled.
          </Alert>
        )}
      </div>

      {cancelled
        ? null
        : groups.map((group) => (
            <Panel
              key={group.role}
              title={
                <>
                  {group.role}{' '}
                  <EventWindow
                    startsAt={group.startsAt}
                    endsAt={group.endsAt}
                    className="mono sm muted"
                  />
                </>
              }
              actions={
                <Pill tone={completed ? 'neutral' : 'green'}>
                  {group.confirmed} {completed ? 'worked' : 'confirmed'}
                </Pill>
              }
              flush
            >
              <div className="wgrid">
                {group.people.map((p) => {
                  const removed = p.name.startsWith('Deleted account');
                  return (
                    <div className="wrow" key={p.bookingId}>
                      <Avatar
                        name={p.name}
                        size="lg"
                        src={p.photoPath ? photos[p.photoPath] : undefined}
                        deleted={removed}
                      />
                      <div>
                        <div className="n">{p.name}</div>
                        <div className="s">{p.role}</div>
                      </div>
                      {p.feedbackGiven ? (
                        <span className="fb sm muted">✓ Feedback sent</span>
                      ) : (
                        <Button
                          className="fb"
                          size="sm"
                          disabled={!open || removed}
                          title={
                            removed
                              ? 'This account has been removed'
                              : open
                                ? undefined
                                : 'Feedback opens once the event has started'
                          }
                          onClick={() => setRating(p)}
                        >
                          Leave feedback
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}

      {rating ? (
        <FeedbackModal
          open
          eventId={event.id}
          bookingId={rating.bookingId}
          personName={rating.name}
          role={rating.role}
          eventTitle={event.title}
          eventDate={ukDateShort(event.startsAt)}
          onClose={() => setRating(null)}
        />
      ) : null}
    </div>
  );
}
