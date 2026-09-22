import Link from 'next/link';
import { Alert, EmptyState, Pill } from '@thc/ui';
import {
  READY_DEADLINE_UK,
  UK_ZONE,
  canCancelShift,
  cancelDeadline,
  explainLimit,
  formatDateTimeIn,
  formatDistance,
  openSlots,
  sectionHours,
  shiftCard,
} from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { applyForShift, cancelShift, confirmToday, markReady, reconfirm } from '../actions';
import { loadBookings, loadOpenShifts, openInvites } from '../data';
import type { BookingRow } from '../data';
import '../staff-app.css';

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

  const [bookings, openShifts] = await Promise.all([loadBookings(), loadOpenShifts()]);
  // §10.4 names them — "Shifts for your roles: Waiting Staff · Bar Staff" —
  // because "your roles" is otherwise a claim the worker cannot check.
  const roleNames = [...new Set([...openShifts.map((s) => s.role), ...bookings.map((b) => b.role)])]
    .sort()
    .join(' · ');
  const mine = bookings.filter((b) => b.status === 'confirmed' || b.status === 'worked');
  const invites = openInvites(bookings).length;
  const needsAction = mine.filter((b) => {
    const card = shiftCard(b);
    return card === 'needs_ready' || card === 'reconfirm';
  }).length;

  return (
    <StaffShell
      title="Shifts"
      active="/shifts"
      shifts={mine.length}
      invites={invites}
      below={
        <div className="seg" role="tablist">
          <Link href="/shifts" className={open ? undefined : 'active'} role="tab">
            My shifts
            {needsAction ? <span className="n alert">{needsAction}!</span> : null}
          </Link>
          <Link href="/shifts?tab=open" className={open ? 'active' : undefined} role="tab">
            Open shifts
          </Link>
        </div>
      }
    >
      {open ? (
        <>
          <p className="xs muted">
            Shifts for your roles{roleNames ? `: ${roleNames}` : ''}, soonest first. Auto-assign
            still runs — self-apply is an extra channel (RULE-08).
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
                    {shift.venueName} · {formatDistance(shift.distanceKm)}
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
                    <p className="m">
                      {explainLimit({
                        weekStart: shift.weekStart,
                        bookedHours: shift.bookedHours,
                        capHours: shift.capHours,
                        shiftHours: sectionHours(shift),
                      }) ??
                        'This shift would take you over your weekly hours limit for that Mon–Sun week.'}
                    </p>
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
        mine.map((booking) => <ShiftCardView key={booking.bookingId} booking={booking} />)
      )}
    </StaffShell>
  );
}

/**
 * One booked shift. Which of the five cards it becomes is `shiftCard()` in
 * `@thc/domain` — the order matters (a changed time outranks even Today) and
 * it is asserted there rather than decided by the order of the JSX.
 */
function ShiftCardView({ booking }: { booking: BookingRow }) {
  const card = shiftCard(booking);
  const tone =
    card === 'today' ? 'today' : card === 'needs_ready' || card === 'reconfirm' ? 'needs' : '';

  return (
    <div className={`mcard ${tone}`.trim()}>
      <div className="card-head">
        {card === 'today' ? <Pill tone="cyan">Today</Pill> : null}
        {card === 'reconfirm' ? (
          <>
            <Pill tone="amber">Time changed</Pill>
            <Pill>Awaiting</Pill>
          </>
        ) : card === 'needs_ready' ? (
          <Pill tone="amber">Needs confirmation</Pill>
        ) : (
          <Pill tone="green">Confirmed</Pill>
        )}
        <span className="right">
          <ShiftTime startsAt={booking.startsAt} endsAt={booking.endsAt} withDate />
        </span>
      </div>

      <Link className="t" href={`/shifts/${booking.bookingId}`}>
        {booking.eventTitle} · {booking.role}
      </Link>
      <div className="m">
        {booking.venueName}, {booking.venueAddress}
      </div>
      <div className="m">
        £{booking.payRate.toFixed(2)}/h
        {booking.dressCode ? ` · Dress code: ${booking.dressCode}` : ''}
      </div>

      {card === 'reconfirm' ? (
        <>
          <p className="m coral">{booking.reconfirmReason ?? 'The office changed this shift.'}</p>
          <ActionButton
            label="Confirm new time"
            tone="primary"
            block
            action={reconfirm.bind(null, booking.bookingId)}
          />
        </>
      ) : null}

      {card === 'needs_ready' ? (
        <>
          <Alert tone="amber">
            Confirm by <b>{READY_DEADLINE_UK} (UK time)</b> the day before — or you’ll be removed
            from this shift.
          </Alert>
          <ActionButton
            label="I’m ready for tomorrow"
            tone="primary"
            block
            action={markReady.bind(null, booking.bookingId)}
          />
        </>
      ) : null}

      {card === 'today' ? (
        <>
          {/* Stage 3 is for a booking still awaiting the worker. One already
              `worked` has been checked into, and confirm_on_day refuses it —
              offering the button would be a press that can only fail. */}
          {booking.status !== 'confirmed' || booking.onDayConfirmedAt ? (
            <p className="m">Check-in and check-out are on the shift screen (§5).</p>
          ) : (
            <>
              <p className="m">
                Reminder only — no deadline. Confirming tells the office you’re on your way (§3.5).
              </p>
              <ActionButton
                label="Confirm today’s shift"
                tone="primary"
                block
                action={confirmToday.bind(null, booking.bookingId)}
              />
            </>
          )}
        </>
      ) : null}

      {/* RULE-04: available strictly while more than 72 hours remain, and it
          bars the worker from this EVENT permanently — said as a SECOND
          sentence, after the one §10.4 fixes word for word.

          Offered on a `reconfirm` card too: §10.4 ties this to the booking
          being confirmed and to the 72-hour window, not to the absence of an
          N11, and a shift the office has just moved is exactly when a worker
          wants their way out of it. */}
      {(card === 'confirmed' || card === 'reconfirm') &&
      booking.status === 'confirmed' &&
      canCancelShift(booking.startsAt) ? (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="xs muted">
            Cancel available until {formatDateTimeIn(cancelDeadline(booking.startsAt), UK_ZONE)}{' '}
            (UK), 72 h before the start
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <ActionButton
              label="Cancel shift"
              tone="ghost"
              size="sm"
              action={cancelShift.bind(null, booking.bookingId)}
              confirm={{
                title: 'Cancel this shift?',
                body: 'We’ll offer this shift to the next person on the list. This can’t be undone. You also won’t be able to take any shift on this event again.',
                confirmLabel: 'Cancel shift',
                keepLabel: 'Keep it',
              }}
            />
          </span>
        </div>
      ) : null}
    </div>
  );
}
