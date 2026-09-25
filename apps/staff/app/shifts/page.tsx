import Link from 'next/link';
import { EmptyState, Pill } from '@thc/ui';
import { explainLimit, formatDistance, openSlots, sectionHours, shiftCard } from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { applyForShift } from '../actions';
import { loadBookings, loadOpenShifts, openInvites } from '../data';
import { loadProfile } from '../profile/data';
import { ShiftCardView } from './ShiftCard';
import { limitSentence, myShifts, shiftsBadge, venueLine } from './list';
import { venuePoint } from './venue';
import type { VenuePoint } from './venue';
import '../staff-app.css';
import './shifts.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shifts · THC Staff' };

/**
 * Shifts — Scope §10.4, wireframes/staff/shifts.html.
 *
 * Segmented: My shifts (booked, with the three-stage confirmation) and Open
 * shifts (the worker's own roles, soonest first, self-apply). The segments
 * are two URLs rather than client state so a worker who taps a push, a
 * back button or a home-screen shortcut lands where they expect.
 *
 * Every time on this screen is the worker's own ROLE window (RULE-18), and
 * the cards awaiting action carry the amber border and the chip — those are
 * the two the worker loses a shift by scrolling past.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const open = tab === 'open';

  const [bookings, openShifts, profile] = await Promise.all([
    loadBookings(),
    loadOpenShifts(),
    loadProfile(),
  ]);
  // §10.4 names them — "Shifts for your roles: Waiting Staff · Bar Staff" —
  // because "your roles" is otherwise a claim the worker cannot check. The
  // roles are the worker's own (`staff_me()`), not the ones that happen to
  // have an open shift today.
  const roleNames = (profile?.roles ?? []).join(' · ');
  const mine = myShifts(bookings);
  const invites = openInvites(bookings).length;
  const needsAction = shiftsBadge(bookings);

  // The today card carries check-in (§10.4), which needs the venue's
  // centre and radius; one reader per today card, never for the rest.
  const venues = new Map<string, VenuePoint | null>();
  await Promise.all(
    mine
      .filter((b) => shiftCard(b) === 'today')
      .map(async (b) => venues.set(b.bookingId, await venuePoint(b.bookingId))),
  );

  return (
    <StaffShell
      title="Shifts"
      active="/shifts"
      shifts={needsAction}
      invites={invites}
      below={
        <div className="seg block" role="tablist">
          <Link
            href="/shifts"
            className={open ? undefined : 'active'}
            role="tab"
            aria-selected={!open}
          >
            My shifts
            {needsAction ? <span className="n alert">{needsAction}!</span> : null}
          </Link>
          <Link
            href="/shifts?tab=open"
            className={open ? 'active' : undefined}
            role="tab"
            aria-selected={open}
          >
            Open shifts
          </Link>
        </div>
      }
    >
      {open ? (
        <>
          <p className="xs muted">
            Shifts for your roles{roleNames ? `: ${roleNames}` : ''}. Auto-assign still runs;
            self-apply is an extra channel (RULE-08).
          </p>
          {openShifts.length === 0 ? (
            <EmptyState>
              <h3>Nothing open right now</h3>
              New shifts are added regularly. Radar shows the same list with distances.
            </EmptyState>
          ) : (
            [...openShifts]
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
              .map((shift) => (
                <div className={`mcard${shift.hoursLimit ? ' muted' : ''}`} key={shift.shiftId}>
                  <div className="card-head">
                    {shift.qualified ? <Pill tone="purple">You’ve worked here before</Pill> : null}
                    {shift.hoursLimit ? <Pill tone="coral">Limit reached</Pill> : null}
                    <span className="right">
                      <ShiftTime startsAt={shift.startsAt} endsAt={shift.endsAt} withDate />
                    </span>
                  </div>
                  <Link className="t" href={`/radar/${shift.shiftId}`}>
                    {shift.eventTitle} · {shift.role}
                  </Link>
                  <div className="m">
                    {venueLine(shift.venueName, shift.venueAddress)} ·{' '}
                    {formatDistance(shift.distanceKm)}
                  </div>
                  <div className="m">
                    £{shift.payRate.toFixed(2)}/h
                    {shift.dressCode ? ` · Dress code: ${shift.dressCode}` : ''} ·{' '}
                    {openSlots({
                      confirmed: shift.confirmedCount,
                      invited: 0,
                      headcount: shift.headcount,
                      buffer: shift.buffer,
                    })}{' '}
                    open
                  </div>
                  {shift.hoursLimit ? (
                    <>
                      <p className="m">
                        {limitSentence({
                          shiftHours: sectionHours(shift),
                          capHours: shift.capHours,
                        }) ??
                          'This shift would take you over your weekly hours limit for that Mon–Sun week.'}
                      </p>
                      {/* §10.4 puts the arithmetic in front of the worker — "18 + 4
                          exceeds the 20-hour limit" — under the wireframe's line. */}
                      <p className="xs muted">
                        {explainLimit({
                          weekStart: shift.weekStart,
                          bookedHours: shift.bookedHours,
                          capHours: shift.capHours,
                          shiftHours: sectionHours(shift),
                        })}
                      </p>
                    </>
                  ) : null}
                  {shift.appliedAt ? (
                    <Pill tone="purple">Applied</Pill>
                  ) : (
                    <ActionButton
                      label="Apply for this shift"
                      tone="outline"
                      block
                      disabled={shift.hoursLimit}
                      disabledLabel="Limit reached"
                      action={applyForShift.bind(null, shift.shiftId)}
                    />
                  )}
                </div>
              ))
          )}
        </>
      ) : mine.length === 0 ? (
        <EmptyState>
          <h3>No shifts booked</h3>
          Accept an invitation, or find one yourself on Radar.
        </EmptyState>
      ) : (
        mine.map((booking) => (
          <ShiftCardView
            key={booking.bookingId}
            booking={booking}
            venue={venues.get(booking.bookingId) ?? null}
          />
        ))
      )}
    </StaffShell>
  );
}
