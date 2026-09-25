'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Panel, Pill } from '@thc/ui';
import { EventWindow } from '../../EventWindow';
import { ukDateLong } from '../../format';
import { feedbackOpen, fillOf, groupBySection, statusTone } from '../../rules';
import type { LineupRow, PortalEvent, RoleSection } from '../../rules';
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
  documents?: ('allocation' | 'signout')[];
}) {
  const [rating, setRating] = useState<LineupRow | null>(null);

  const at = useMemo(() => new Date(now), [now]);
  const groups = useMemo(() => groupBySection(lineup, sections), [lineup, sections]);
  const fill = useMemo(() => fillOf(sections), [sections]);
  // Two sections of one role are two panels but still one role.
  const roleCount = useMemo(() => new Set(groups.map((g) => g.role)).size, [groups]);
  const open = feedbackOpen(event, at);
  const cancelled = event.status === 'cancelled';

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
                After completion the allocation sheet stays downloadable
                as history, beside the signed timesheet (wireframe). */}
            {cancelled
              ? null
              : (() => {
                  const kind = event.status === 'completed' ? 'signout' : 'allocation';
                  const label =
                    kind === 'signout'
                      ? '↓ Download Signed Timesheet'
                      : '↓ Download Allocation Sheet';
                  const history =
                    kind === 'signout' && documents.includes('allocation') ? (
                      <a
                        className="btn"
                        href={`/client/events/${event.id}/document?kind=allocation`}
                      >
                        ↓ Allocation Sheet
                      </a>
                    ) : null;
                  return (
                    <>
                      {history}
                      {documents.includes(kind) ? (
                        <a
                          className="btn primary"
                          href={`/client/events/${event.id}/document?kind=${kind}`}
                        >
                          {label}
                        </a>
                      ) : (
                        <Button tone="primary" disabled title="Not issued yet">
                          {label}
                        </Button>
                      )}
                    </>
                  );
                })()}
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
            <div className="k">Confirmed staff</div>
            <div className="v">
              <b>{fill.confirmed}</b> of {fill.headcount} ·{' '}
              {roleCount === 1 ? '1 role' : `${roleCount} roles`}
            </div>
          </div>
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
            Feedback opens once the event has started. Until then the &ldquo;Leave feedback&rdquo;
            buttons are disabled.
          </Alert>
        )}
      </div>

      {cancelled
        ? null
        : groups.map((group) => (
            <Panel
              key={group.key}
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
              actions={<Pill tone="green">{group.confirmed} confirmed</Pill>}
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
          onClose={() => setRating(null)}
        />
      ) : null}
    </div>
  );
}
