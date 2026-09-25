'use client';

import Link from 'next/link';
import { Alert, EmptyState, Note, Panel, Pill, ScheduledWindow } from '@thc/ui';
import { addedOn, availabilityLength, availabilityRepeats, availabilityWhen } from './additions';
import type { AvailabilityRow } from './types';

/**
 * The Availability tab (ADR-0036), `wireframes/backoffice/change-requests.html`
 * → "/staff/:id · Availability tab".
 *
 * Read-only on purpose: the worker keeps their own calendar in the app, and
 * an office edit would be a second writer to a gate auto-assign obeys. The
 * next 8 weeks, UK time (the entries are UK wall clock by construction).
 * A confirmed booking inside an entry is listed against it — the entry
 * never cancels it; the worker is pointed at Cancel / Offer instead.
 */
export function Availability({
  rows,
  problem,
  name,
}: {
  rows: AvailabilityRow[];
  problem?: string | null;
  name: string;
}) {
  return (
    <div className="stack">
      {problem ? <Alert tone="coral">The calendar could not be read: {problem}</Alert> : null}
      <Panel
        flush
        title="Marked unavailable · next 8 weeks"
        actions={
          <span className="muted sm">read-only — the worker edits this in the app · UK time</span>
        }
      >
        <div className="panel-b tight">
          {rows.length === 0 ? (
            <EmptyState>
              <h3>Nothing marked in the next 8 weeks</h3>
              <p>
                {name} has not said they can&rsquo;t work any day in this period, so auto-assign
                treats them as available.
              </p>
            </EmptyState>
          ) : (
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>When (UK)</th>
                  <th>Length</th>
                  <th>Repeats</th>
                  <th>Overlaps a booking</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const repeats = availabilityRepeats(row);
                  return (
                    <tr key={row.id}>
                      <td className="cell-title">{availabilityWhen(row)}</td>
                      <td data-label="Length" className="mono sm">
                        {availabilityLength(row)}
                      </td>
                      <td data-label="Repeats">{repeats ?? <span className="muted">—</span>}</td>
                      <td data-label="Overlaps a booking">
                        {row.bookings.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          row.bookings.map((booking) => (
                            <div key={booking.bookingId}>
                              <Link href={`/events/${booking.eventId}`}>
                                {booking.eventTitle} · {booking.roleName} ·{' '}
                                <ScheduledWindow
                                  startsAt={booking.startsAt}
                                  endsAt={booking.endsAt}
                                />
                              </Link>{' '}
                              <Pill tone="green">Confirmed</Pill>
                            </div>
                          ))
                        )}
                      </td>
                      <td data-label="Added" className="mono sm">
                        {addedOn(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
      <Note>
        Auto-assign skips {name} for any role section overlapping these — first round, hourly
        rounds, refills, escalation and offer pushes. On the event board they appear under
        Unavailable as &ldquo;Marked unavailable&rdquo;, and a manager can still invite them by hand
        after a warning (ADR-0036, Q9). A confirmed booking is never cancelled by an entry.
      </Note>
    </div>
  );
}
