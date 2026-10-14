'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Panel, Pill, useViewerZone } from '@thc/ui';
import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { AsOf } from '../../../_components/AsOf';
import { Arrivals } from '../../ArrivalsPill';
import type { EventArrivals } from '../../arrivals';
import { DocumentLink } from '../../DocumentLink';
import { EventWindow } from '../../EventWindow';
import { OFFICE_EMAIL } from '../../account/copy';
import { recipientsLine, telHref } from '../../contact';
import { ukDateLong, ukDateShort, ukDayMonth, ukStamp } from '../../format';
import {
  arrivalsWithinHeadcount,
  documentPendingLine,
  eventEnded,
  feedbackInviteShown,
  feedbackInviteText,
  feedbackOpen,
  fillOf,
  groupBySection,
  headerDocuments,
  isRemoved,
  momentIn,
  roleCountOf,
  sectionCountLabel,
  sectionTone,
  statusTone,
} from '../../rules';
import type { DocumentKind, LineupRow, PortalEvent, RoleSection } from '../../rules';
import type { ClientEvent } from '../../data';
import { CalendarButton } from './CalendarButton';
import { FeedbackModal } from './FeedbackModal';
import { PrintButton } from './PrintButton';
import { RateEveryone } from './RateEveryone';
import { RATE_ALL_FROM, stillToRate } from './rate-all';

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
  thcPhone = null,
}: {
  /** With `timesheetRecipients` when the page read them (ADR-0134 N3). */
  event: PortalEvent & Pick<ClientEvent, 'timesheetRecipients'>;
  sections: RoleSection[];
  lineup: LineupRow[];
  /** Signed photo URLs keyed by `bookingId` (photos.ts); never a Storage path. */
  photos: Record<string, string>;
  now: string;
  /** Which §11.3 PDFs the office has produced for this event. */
  documents?: IssuedDocument[];
  /** On-the-day check-in counts (ADR-0053); counts only, never who. */
  arrivals?: EventArrivals;
  /** THC's on-the-day phone number (ADR-0134 N1); no link when null. */
  thcPhone?: string | null;
}) {
  const [rating, setRating] = useState<LineupRow | null>(null);
  // Sent from this page and not yet re-read: the row says "✓ Feedback sent"
  // at once, rather than flashing "Leave feedback" until the refresh lands.
  const [sentHere, setSentHere] = useState<ReadonlySet<string>>(() => new Set());
  // Where focus goes once the popup has closed on a successful send: the
  // row's own "✓ Feedback sent", not <body>.
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (!focusAfter || rating) return;
    const target = rowButtons.current.get(focusAfter);
    if (target && target.isConnected) {
      target.focus();
      setFocusAfter(null);
    }
  }, [focusAfter, rating, lineup]);

  const at = useMemo(() => new Date(now), [now]);
  const groups = useMemo(() => groupBySection(lineup, sections), [lineup, sections]);
  // Two sections of one role are two panels but still one role; counted
  // from the sections the customer booked, so "0 of 6" still says "2 roles".
  const roleCount = useMemo(() => roleCountOf(sections, lineup), [sections, lineup]);
  const fill = useMemo(() => fillOf(sections), [sections]);
  const open = feedbackOpen(event, at);
  const invite = feedbackInviteShown(event, lineup, at);
  // Nobody on the line-up who could be rated: no banner about buttons that
  // are not on the page, whether feedback has opened or not.
  const rateable = lineup.some((p) => !isRemoved(p));
  const cancelled = event.status === 'cancelled';
  const completed = event.status === 'completed';
  // "On the day" (ADR-0053): the count is live information about the shift in
  // progress. Once the event is over the signed timesheet is the record.
  // Each section held to its headcount, as "N of M confirmed" is.
  const live = event.status === 'ongoing' ? arrivalsWithinHeadcount(arrivals, sections) : undefined;
  const ended = eventEnded(event, at);
  const downloads = headerDocuments(
    event.status,
    documents.map((d) => d.kind),
  );
  const timesheet = completed ? documents.find((d) => d.kind === 'signout') : undefined;
  const call = telHref(thcPhone);
  // "Rate everyone" (ADR-0134 P4): once feedback is open, for two or more
  // still to rate on the visible line-up.
  const toRate = open && !cancelled ? stillToRate(lineup, sentHere) : [];
  // A cancelled event has no documents (§3.3), so nobody to send them to.
  const recipients = cancelled ? [] : recipientsLine(event.timesheetRecipients);

  return (
    <div className="stack epage">
      <div className={cancelled ? 'ehead cancelled' : 'ehead'}>
        <div className="row wrap">
          <Link className="sm back-link" href="/client">
            ← Your events
          </Link>
          <span className="muted sm">
            <span className="sep">· </span>
            <AsOf now={now} />
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
                <DocumentLink
                  key={kind}
                  className={primary ? 'btn primary' : 'btn'}
                  href={`/client/events/${event.id}/document?kind=${kind}`}
                >
                  {label}
                </DocumentLink>
              ) : (
                // Not issued yet: no dead button, a quiet line saying what
                // to expect, as on the list (documentPendingLine).
                <span key={kind} className="ev-sheet doc-pending">
                  {documentPendingLine(kind, event, at)}
                </span>
              );
            })}
            {/* ADR-0050: an .ics built in the browser; none when cancelled,
                and none once the event is over — nothing left to attend. */}
            {ended ? null : <CalendarButton event={event} />}
            {/* ADR-0134 N6: the line-up on paper for the door, before the
                PDF is issued. Nothing to print for a cancelled event. */}
            {cancelled ? null : <PrintButton />}
            {/* A question about this event goes to the office, with the
                event already named in the subject. */}
            <a className="btn ghost" href={contactHref(event)}>
              Contact THC about this event
            </a>
            {/* "Who do I call at 07:30?" (ADR-0134 N1): the number the
                office set on /settings, none until it has. */}
            {call ? (
              <a className="btn ghost call-thc" href={call} aria-label={`Call THC on ${thcPhone}`}>
                Call THC · <span className="num">{thcPhone}</span>
              </a>
            ) : null}
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
          {recipients.length > 0 ? (
            <div className="meta-recipients">
              <div className="k">Timesheets go to</div>
              <div className="v recipients">
                {/* ADR-0089 via ADR-0134 N3: the event's own list, or the
                    addresses on the client card. */}
                {/* One per line, breaking after the "@" before anywhere
                    else, so "leonardo-stpauls.example" stays whole. */}
                {recipients.map((address) => {
                  const at = address.indexOf('@');
                  return (
                    <span key={address} className="addr">
                      {at > 0 ? (
                        <>
                          {address.slice(0, at + 1)}
                          <wbr />
                          {address.slice(at + 1)}
                        </>
                      ) : (
                        address
                      )}
                    </span>
                  );
                })}
                <span className="sub">for this event · ask THC to change who receives them</span>
              </div>
            </div>
          ) : null}
          <div>
            <div className="k">Your on-site contact</div>
            <div className="v">
              {event.onsiteContact ?? '—'}
              {/* Per event (§3.2): pre-filled from the client profile when
                  the event is created, and editable for this event alone. */}
              <span className="sub">for this event · usually the contact on your client card</span>
            </div>
          </div>
        </div>

        {cancelled ? (
          <Alert tone="neutral">
            This event was cancelled, so there is no confirmed line-up to show.
          </Alert>
        ) : !rateable ? null : open ? (
          invite ? (
            <Alert tone="green">{feedbackInviteText(event, at)}</Alert>
          ) : null
        ) : (
          <FeedbackLocked startsAt={event.startsAt} now={at} />
        )}

        {toRate.length >= RATE_ALL_FROM ? (
          <div className="row wrap rate-all-row">
            <RateEveryone
              eventId={event.id}
              eventTitle={event.title}
              eventDate={ukDateShort(event.startsAt)}
              people={toRate}
              photos={photos}
              onSent={(ids) => setSentHere((prev) => new Set([...prev, ...ids]))}
            />
            <span className="sm muted">
              Or one at a time with &ldquo;Leave feedback&rdquo; beside each person.
            </span>
          </div>
        ) : null}
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
                  {/* Held to the headcount: a section carrying THC's buffer
                      reads "4 of 4", never "6 of 4", and the line-up below
                      stops at the headcount too (client_lineup_v, ADR-0134). */}
                  <Pill tone={sectionTone(group, completed)}>
                    {sectionCountLabel(group, completed)}
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
              {/* The role's dress code, from the customer's own rate card
                  (ADR-0134 N2). */}
              {group.dressCode ? (
                <p className="role-dress sm">
                  <span className="k">Dress code</span> {group.dressCode}
                </p>
              ) : null}
              {group.people.length === 0 ? (
                // A section nobody has confirmed on yet still shows its role
                // and window, and says so in one line.
                <p className="wempty muted sm">
                  {completed ? 'Nobody worked this role.' : 'Nobody confirmed yet.'}
                </p>
              ) : (
                <div className="wgrid">
                  {group.people.map((p) => {
                    const removed = isRemoved(p);
                    const given = p.feedbackGiven || sentHere.has(p.bookingId);
                    const sent = p.feedbackGiven ? sentLine(p) : null;
                    const keep = (el: HTMLButtonElement | null) => {
                      rowButtons.current.set(p.bookingId, el);
                    };
                    return (
                      <div className="wrow" key={p.bookingId}>
                        <Avatar
                          name={p.name}
                          size="lg"
                          src={photos[p.bookingId]}
                          deleted={removed}
                          silhouette
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
                        {given ? (
                          // aria-disabled, not disabled: a status that can
                          // still hold focus, so focus lands here after a
                          // send instead of dropping to the page (WCAG 2.4.3).
                          <button
                            ref={keep}
                            type="button"
                            className="btn sm fb sent"
                            aria-disabled="true"
                            aria-label={`Feedback sent for ${p.name}`}
                            title="Your feedback is read-only once sent"
                          >
                            ✓ Feedback sent
                          </button>
                        ) : (
                          // Named per worker: twelve buttons all called
                          // "Leave feedback" told a screen reader nothing.
                          <button
                            ref={keep}
                            type="button"
                            className={removed ? 'btn sm fb gone' : 'btn sm fb'}
                            disabled={!open || removed}
                            aria-label={`Leave feedback for ${p.name}`}
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
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          ))}

      {rating ? (
        <FeedbackModal
          open
          eventId={event.id}
          bookingId={rating.bookingId}
          personName={rating.name}
          photo={photos[rating.bookingId]}
          role={rating.role}
          eventTitle={event.title}
          eventDate={ukDateShort(event.startsAt)}
          onClose={() => setRating(null)}
          onSent={() => {
            const id = rating.bookingId;
            setSentHere((prev) => new Set(prev).add(id));
            setFocusAfter(id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The mail link behind "Contact THC about this event": the office address
 * (`OFFICE_EMAIL`, the one the rest of the portal shows), with a subject
 * naming the event as the office files it — title, UK date, PO when there is
 * one — so the reply does not start with "which event?".
 */
export function contactHref(event: Pick<PortalEvent, 'title' | 'startsAt' | 'poNumber'>): string {
  const subject = [
    event.title,
    ukDateShort(event.startsAt),
    event.poNumber && `PO ${event.poNumber}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return `mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(subject)}`;
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
