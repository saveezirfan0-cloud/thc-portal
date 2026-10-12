'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Panel, Pill, useViewerZone } from '@thc/ui';
import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { AsOf } from '../../../_components/AsOf';
import { Arrivals } from '../../ArrivalsPill';
import type { EventArrivals } from '../../arrivals';
import { EventWindow } from '../../EventWindow';
import { ukDateLong, ukDateShort, ukDayMonth, ukStamp } from '../../format';
import {
  feedbackInviteShown,
  feedbackOpen,
  fillOf,
  groupBySection,
  headerDocuments,
  isRemoved,
  momentIn,
  statusTone,
} from '../../rules';
import type { DocumentKind, LineupRow, PortalEvent, RoleSection } from '../../rules';
import { CalendarButton } from './CalendarButton';
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
  arrivals,
}: {
  event: PortalEvent;
  sections: RoleSection[];
  lineup: LineupRow[];
  photos: Record<string, string>;
  now: string;
  /** Which §11.3 PDFs the office has produced for this event. */
  documents?: IssuedDocument[];
  /** On-the-day check-in counts (ADR-0053); counts only, never who. */
  arrivals?: EventArrivals;
}) {
  const [rating, setRating] = useState<LineupRow | null>(null);

  const at = useMemo(() => new Date(now), [now]);
  const groups = useMemo(() => groupBySection(lineup, sections), [lineup, sections]);
  // Two sections of one role are two panels but still one role.
  const roleCount = useMemo(() => new Set(groups.map((g) => g.role)).size, [groups]);
  const fill = useMemo(() => fillOf(sections), [sections]);
  const open = feedbackOpen(event, at);
  const invite = feedbackInviteShown(event, lineup, at);
  const cancelled = event.status === 'cancelled';
  const completed = event.status === 'completed';
  // "On the day" (ADR-0053): the count is live information about the shift in
  // progress. Once the event is over the signed timesheet is the record.
  const live = event.status === 'ongoing' ? arrivals : undefined;
  const downloads = headerDocuments(
    event.status,
    documents.map((d) => d.kind),
  );
  const timesheet = completed ? documents.find((d) => d.kind === 'signout') : undefined;

  return (
    <div className="stack epage">
      <div className={cancelled ? 'ehead cancelled' : 'ehead'}>
        <div className="row wrap">
          <Link className="sm" href="/client">
            ← Your events
          </Link>
          <span className="muted sm">
            · <AsOf now={now} />
          </span>
        </div>

        <div className="row wrap top">
          <div>
            <h1>{cancelled ? <s>{event.title}</s> : event.title}</h1>
            <div className="muted sm">
              {event.venueName} · {event.venueAddress}
              {cancelled && event.cancelledAt
                ? ` · cancelled ${ukDayMonth(event.cancelledAt)}`
                : ''}
            </div>
          </div>
          <Pill tone={statusTone(event.status)} large dot={event.status === 'ongoing'}>
            {STATUS_LABEL[event.status]}
          </Pill>
          <Arrivals counts={live} large />
          {event.poNumber ? <Pill large>PO Number · {event.poNumber}</Pill> : null}

          <div className="actions row">
            {/* §11.2's header action: the §11.3 PDF, once the office has
                produced one. Download only; sending is the office's (§11.4).
                Completed: the signed timesheet takes the primary slot and the
                allocation sheet stays beside it as history (event.html:247). */}
            {downloads.map(({ kind, available }) => {
              const label =
                kind === 'signout'
                  ? '↓ Download Completed Timesheet'
                  : completed
                    ? '↓ Allocation Timesheet'
                    : '↓ Download Allocation Timesheet';
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
            {/* ADR-0050: an .ics built in the browser; none when cancelled. */}
            <CalendarButton event={event} />
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
              {roleCount === 1 ? '1 role' : `${roleCount} roles`}
            </div>
          </div>
          {timesheet ? (
            <div>
              <div className="k">Timesheet</div>
              <div className="v">
                {/* An audit stamp: UK-only, never dual, and labelled (§1.8).
                    Nothing is said about who it was emailed to: the view
                    records that a final copy exists, not whether or to whom
                    the office sent it (ADR-0089). */}
                Completed Allocation Timesheet generated {ukStamp(timesheet.issuedAt)}
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
          invite ? (
            <Alert tone="green">
              The event has started — you can now leave feedback on each member of staff. One entry
              per person per event.
            </Alert>
          ) : null
        ) : (
          <FeedbackLocked startsAt={event.startsAt} now={at} />
        )}
      </div>

      {cancelled
        ? null
        : groups.map((group) => (
            <Panel
              key={group.key}
              className="role-panel"
              title={
                <span className="role-title">
                  <span>{group.role}</span>
                  <EventWindow startsAt={group.startsAt} endsAt={group.endsAt} className="rw" />
                </span>
              }
              actions={
                <>
                  <Pill tone={completed ? 'neutral' : 'green'}>
                    {group.confirmed} {completed ? 'worked' : 'confirmed'}
                  </Pill>
                  <Arrivals
                    counts={live}
                    shiftIds={[group.key]}
                    startsAt={group.startsAt}
                    now={at}
                  />
                </>
              }
              flush
            >
              <div className="wgrid">
                {group.people.map((p) => {
                  const removed = isRemoved(p);
                  const sent = p.feedbackGiven ? sentLine(p) : null;
                  return (
                    <div className="wrow" key={p.bookingId}>
                      <Avatar
                        name={p.name}
                        size="lg"
                        src={p.photoPath ? photos[p.photoPath] : undefined}
                        deleted={removed}
                      />
                      <div className="who">
                        <div className={removed ? 'n muted' : 'n'}>{p.name}</div>
                        <div className="s">
                          {p.role}
                          {sent ? (
                            <>
                              {' · '}
                              <span className="fb-sent">{sent}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {p.feedbackGiven ? (
                        <Button
                          className="fb sent"
                          size="sm"
                          disabled
                          title="Your feedback is read-only once sent"
                        >
                          ✓ Feedback sent
                        </Button>
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
          photo={rating.photoPath ? photos[rating.photoPath] : undefined}
          role={rating.role}
          eventTitle={event.title}
          eventDate={ukDateShort(event.startsAt)}
          onClose={() => setRating(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * "★★★★☆ sent 20 Sep" under a rated worker's role (event.html:251): the
 * customer's own stars and the UK day they sent them. Either half is left
 * out when the view did not return it; null when there is nothing to say.
 */
export function sentLine(row: Pick<LineupRow, 'feedbackRating' | 'feedbackSentAt'>): string | null {
  const rating = row.feedbackRating;
  const stars =
    typeof rating === 'number' && rating >= 1 && rating <= 5
      ? '★'.repeat(rating) + '☆'.repeat(5 - rating)
      : null;
  const when = row.feedbackSentAt ? `sent ${ukDayMonth(row.feedbackSentAt)}` : null;
  if (!stars && !when) return null;
  return [stars, when].filter(Boolean).join(' ');
}

/**
 * The locked-feedback banner (§11.2): when the buttons unlock, in UK time,
 * and — once mounted, for a reader outside UK time — in theirs, written as
 * the "Next up" strip writes it ("tomorrow 08:00 your time"), so it is the
 * reader's own calendar day too (§1.8).
 */
function FeedbackLocked({ startsAt, now }: { startsAt: string; now: Date }) {
  const zone = useViewerZone();
  const mine = needsDualZone(zone) ? momentIn(startsAt, now, false, zone) : null;
  return (
    <Alert tone="cyan">
      Feedback opens once the event has started — from {formatTimeIn(new Date(startsAt), UK_ZONE)}{' '}
      UK time on the day{mine ? ` (${mine} your time)` : ''}. Until then the &ldquo;Leave
      feedback&rdquo; buttons are disabled.
    </Alert>
  );
}
