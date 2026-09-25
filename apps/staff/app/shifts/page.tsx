import Link from 'next/link';
import { Alert, EmptyState, Pill } from '@thc/ui';
import {
  READY_DEADLINE_UK,
  canCancelShift,
  explainLimit,
  formatDistance,
  openSlots,
  sectionHours,
  shiftCard,
} from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { CancelShift } from '../_components/CancelShift';
import { LoadProblem } from '../_components/LoadProblem';
import { UkTime } from '../_components/UkTime';
import { applyForShift, confirmToday, markReady, reconfirm } from '../actions';
import { loadBookings, loadOpenShifts, openInvites } from '../data';
import type { BookingRow } from '../data';
import { checkInWindow } from './[id]/phase';
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

  const [{ rows: bookings, problem: bookingsProblem }, { rows: openShifts, problem: openProblem }] =
    await Promise.all([loadBookings(), loadOpenShifts()]);
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
      // A failed read has no count to show, and a 0 badge would be a claim.
      {...(bookingsProblem ? {} : { shifts: mine.length, invites })}
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
            still runs — self-apply is an extra channel.
          </p>
          {openProblem ? (
            // Audit D18: a failed read is not "Nothing open".
            <LoadProblem what="open shifts" />
          ) : openShifts.length === 0 ? (
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
                    {shift.hoursLimit ? <Pill tone="coral">Limit Reached</Pill> : null}
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
                      disabledLabel="Limit Reached"
                      action={applyForShift.bind(null, shift.shiftId)}
                    />
                  )}
                </div>
              ))
          )}
        </>
      ) : bookingsProblem ? (
        // Audit D18: "No shifts booked" to a worker who has one is how a
        // No-show happens. A failed read says so, with a retry.
        <LoadProblem what="your shifts" />
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
        {card === 'today' ? (
          <TodayPill booking={booking} />
        ) : card === 'reconfirm' ? (
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

      {card === 'today' ? <TodayActions booking={booking} /> : null}

      {/* RULE-04 — the same row, dialog and words as the shift screen's.
          Offered on a `reconfirm` card too: §10.4 ties this to the booking
          being confirmed and to the 72-hour window, not to the absence of an
          N11, and a shift the office has just moved is exactly when a worker
          wants their way out of it. */}
      {(card === 'confirmed' || card === 'reconfirm') &&
      booking.status === 'confirmed' &&
      canCancelShift(booking.startsAt) ? (
        <CancelShift bookingId={booking.bookingId} startsAt={booking.startsAt} />
      ) : null}
    </div>
  );
}

/** Today, the second pill: where the on-day stage stands (§3.5, §10.4). */
function TodayPill({ booking }: { booking: BookingRow }) {
  if (booking.status === 'worked') {
    return (
      <Pill tone="green" dot>
        Checked in
      </Pill>
    );
  }
  // Stage 3 outstanding. A reminder, never a release — but the office's
  // board reads the same flag, so the worker sees it too.
  if (!booking.onDayConfirmedAt) return <Pill tone="amber">Not confirmed today</Pill>;
  return <Pill tone="green">Confirmed</Pill>;
}

/**
 * The today card's actions (§10.4): check-in lives INSIDE the card, and the
 * on-day confirm sits above it while it is outstanding.
 *
 * "Check in — verify GPS" opens the shift screen with `?checkin=1`, which
 * starts the GPS verification on arrival and presses check-in itself once
 * the worker is inside the circle. The map, the distance line and the
 * turn-away all live there; a second implementation of them on the card
 * would be a second place for them to disagree.
 */
function TodayActions({ booking, now = new Date() }: { booking: BookingRow; now?: Date }) {
  const href = `/shifts/${booking.bookingId}`;

  // Already checked in: the way to the timer, the breaks and check-out.
  // Stage 3 is not offered — confirm_on_day refuses a `worked` booking, so
  // the button would be a press that can only fail.
  if (booking.status !== 'confirmed') {
    return (
      <Link className="btn block lg" href={href}>
        Open shift
      </Link>
    );
  }

  const window = checkInWindow({
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    confirmedAt: booking.confirmedAt ? booking.confirmedAt.toISOString() : null,
  });
  const open = now >= window.opens && now < window.locks;
  const closed = now >= window.locks;
  const outstanding = !booking.onDayConfirmedAt;

  return (
    <>
      {outstanding ? (
        <>
          <p className="m">
            Reminder only — no deadline. Confirming tells the office you’re on your way.
          </p>
          <ActionButton
            label="Confirm today’s shift"
            // Once check-in is open, THAT is the one thing to press.
            tone={open ? 'outline' : 'primary'}
            block
            action={confirmToday.bind(null, booking.bookingId)}
          />
        </>
      ) : null}
      {closed ? (
        <Link className="btn block" href={href}>
          Check-in closed — open shift
        </Link>
      ) : (
        <>
          <Link
            className={`btn block lg${outstanding && !open ? ' outline' : ' primary'}`}
            href={`${href}?checkin=1`}
          >
            Check in — verify GPS
          </Link>
          <p className="xs muted">
            {open ? (
              <>
                Check-in is open until <UkTime at={window.locks} />.
              </>
            ) : (
              <>
                Check-in opens at <UkTime at={window.opens} />, 30 min before the start.
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}
