'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { EVENT_STATUS_LABEL, type EventStatus, eventStatus } from '@thc/domain';
import { EmptyState, Pill } from '@thc/ui';
import {
  type UpcomingEvent,
  allocationLabel,
  fillChip,
  formatDayLabel,
  formatMarginPerHour,
  marginTone,
  relativeDayLabel,
} from '../view-model';
import { ScheduledWindow } from './ScheduledWindow';

/**
 * §9.1 "Upcoming events — 10 days ahead, by date. On each role's row show
 * the margin +£X/h in green (charge − final pay)."
 *
 * One table row per EVENT, with one line per role section inside the Roles
 * cell — the shape `wireframes/backoffice/dashboard.html` draws, and the
 * one §9.1 needs: the margin belongs to the role, and two roles on one
 * event routinely run different windows (§3.2, RULE-18).
 *
 * Cancelled events stay on the list, struck through and greyed, and say so
 * where the fill would be: §3.3 keeps them visible and out of the money.
 *
 * The whole row opens the event board, as the wireframe's `tr.clickable`
 * does — the `clickable` class promises a pointer and a hover tint, and a
 * row that only looked clickable did nothing. The title keeps its Link for
 * the keyboard and for "open in a new tab".
 */

const STATUS_TONE: Record<EventStatus, 'cyan' | 'green' | 'neutral'> = {
  upcoming: 'cyan',
  ongoing: 'green',
  completed: 'neutral',
  cancelled: 'neutral',
};

export function UpcomingTable({
  events,
  today,
  showMargin = true,
}: {
  events: UpcomingEvent[];
  today: string;
  /** False for an office role without finance (ADR-0050): the view returns no rate either. */
  showMargin?: boolean;
}) {
  const router = useRouter();
  if (events.length === 0) {
    return <EmptyState>Nothing in the diary for the next ten days.</EmptyState>;
  }

  const openEvent = (eventId: string) => (event: MouseEvent<HTMLTableRowElement>) => {
    // A click on the title's own link, or on anything else interactive in
    // the row, is already handled — one navigation, not two.
    if ((event.target as HTMLElement).closest('a, button')) return;
    router.push(`/events/${eventId}`);
  };

  return (
    <table className="tbl card-rows dash-upcoming">
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Client · Venue</th>
          {/* Scheduled times, so the column names its zone (§1.8). */}
          <th>Window (UK time)</th>
          <th>
            {showMargin ? 'Roles · allocation · fill · margin/h' : 'Roles · allocation · fill'}
          </th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const status = eventStatus(
            { startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) },
            event.cancelledAt,
          );
          const cancelled = status === 'cancelled';
          const relative = relativeDayLabel(event.eventDate, today);

          return (
            <tr
              key={event.eventId}
              className={cancelled ? undefined : 'clickable'}
              onClick={cancelled ? undefined : openEvent(event.eventId)}
            >
              <td data-label="Date">
                <b className={relative ? 'cyan' : undefined}>{formatDayLabel(event.eventDate)}</b>
                {relative ? <span className="sub">{relative}</span> : null}
              </td>
              <td className={cancelled ? 'cell-title muted' : 'cell-title'}>
                {cancelled ? (
                  <s>{event.title}</s>
                ) : (
                  <Link href={`/events/${event.eventId}`}>
                    <b>{event.title}</b>
                  </Link>
                )}
                <span className="sub">PO {event.poNumber || '—'}</span>
              </td>
              <td data-label="Client · Venue" className={cancelled ? 'muted' : undefined}>
                {event.clientName}
                <span className="sub">{event.venueName}</span>
              </td>
              <td data-label="Window (UK time)" className={cancelled ? 'mono sm muted' : 'mono sm'}>
                {/* The event window is derived: min start → max end (RULE-18). */}
                <ScheduledWindow startsAt={event.startsAt} endsAt={event.endsAt} />
              </td>
              <td data-label="Roles · allocation · fill · margin/h" className="cell-wide">
                {cancelled ? (
                  <span className="muted sm">
                    {event.roles.length} {event.roles.length === 1 ? 'role' : 'roles'} · excluded
                    from financials
                  </span>
                ) : (
                  <div className="dash-roles">
                    {event.roles.map((role) => {
                      const chip = fillChip(role.confirmed, role.headcount);
                      return (
                        <div className="r" key={role.shiftId}>
                          <span className="chip">{role.roleName}</span>
                          {/* The role's OWN window, never the event's (RULE-18). */}
                          <ScheduledWindow
                            className="mono win"
                            startsAt={role.startsAt}
                            endsAt={role.endsAt}
                          />
                          {/* "6 (+1)": the buffer is absolute, never folded in. */}
                          <span className="mono alloc">
                            {allocationLabel(role.headcount, role.buffer)}
                          </span>
                          <Pill tone={chip.tone}>{chip.label}</Pill>
                          {/* §9.1: charge − final pay, in green. */}
                          {showMargin ? (
                            <span className={`mono margin ${marginTone(role.marginPerHour)}`}>
                              {formatMarginPerHour(role.marginPerHour)}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </td>
              <td data-label="Status">
                <Pill tone={STATUS_TONE[status]} dot={status === 'ongoing'}>
                  {EVENT_STATUS_LABEL[status]}
                </Pill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
