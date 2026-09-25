import Link from 'next/link';
import { Alert, EmptyState, Pill } from '@thc/ui';
import {
  READY_DEADLINE_UK,
  STATIC_SCREEN_COPY,
  UK_ZONE,
  canCancelShift,
  cancelDeadline,
  explainLimit,
  formatDateIn,
  formatDateTimeIn,
  formatDistance,
  formatTimeIn,
  openSlots,
  readyDeadlinePassed,
  sectionHours,
} from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { applyForShift, cancelShift, confirmToday, markReady, reconfirm } from '../actions';
import { loadBookings, loadOpenShifts, loadWeekMeter, openInvites } from '../data';
import type { BookingRow } from '../data';
import { WeekMeter } from '../radar/WeekMeter';
import { weekLabel } from '../radar/model';
import { checkOutClosesAt, myShiftCard, myShifts } from './model';
import type { MyShiftCard, ShiftGroup } from './model';
import { COVER_CHIP, offeredCardLine } from './offers';
import type { BookingOffer } from './offers';
import { loadBookingOffers } from './offers-data';
import { YourTimeAt } from './YourTimeAt';
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
 *
 * My shifts is `myShifts()` (./model.ts): soonest first under Today ·
 * Tomorrow · This week · Later (UK calendar days), each card staying until
 * its check-out window closes (end + 4 h, RULE-02). After that it is
 * history, in a collapsed "Past shifts" section — the wireframe draws only
 * the live cards, and §10.4 keeps completed-shift pay under Profile →
 * Payment information, so the past is one tap away and never in the way.
 * Above the list, the RULE-20 meter for the current Mon–Sun week: the same
 * `staff_week_meter()` and `WeekMeter` Radar shows, so the two agree.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const open = tab === 'open';

  const [bookings, openShifts, meter, offers] = await Promise.all([
    loadBookings(),
    loadOpenShifts(),
    loadWeekMeter(),
    // ADR-0039: the open offer on each confirmed booking, for the chip.
    loadBookingOffers(),
  ]);
  const now = new Date();
  // §10.4 names them — "Shifts for your roles: Waiting Staff · Bar Staff" —
  // because "your roles" is otherwise a claim the worker cannot check.
  const roleNames = [...new Set([...openShifts.map((s) => s.role), ...bookings.map((b) => b.role)])]
    .sort()
    .join(' · ');
  const list = myShifts(bookings, now);
  const current = list.upcoming.flatMap((g) => g.bookings);
  const invites = openInvites(bookings, now).length;
  const needsAction = current.filter((b) => {
    const card = myShiftCard(b, now);
    return card === 'needs_ready' || card === 'reconfirm';
  }).length;

  return (
    <StaffShell
      title="Shifts"
      active="/shifts"
      // The same count `shiftsBadge()` gives every other tab: the upcoming
      // list, never the collapsed past.
      shifts={list.upcomingCount}
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
            still runs — self-apply is an extra channel.
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
      ) : (
        <>
          {meter ? (
            <WeekMeter
              label={`This week (${weekLabel(meter.weekStart, meter.weekEnd)})`}
              bookedHours={meter.bookedHours}
              capHours={meter.capHours}
            />
          ) : null}
          {current.length === 0 ? (
            <EmptyState>
              <h3>No shifts booked</h3>
              Accept an invitation, or find one yourself on Radar.
            </EmptyState>
          ) : (
            list.upcoming.map(({ group, label, bookings: inGroup }) => (
              <section key={group} className="shift-group" aria-label={label}>
                <div className="grp">{label}</div>
                {inGroup.map((booking) => (
                  <ShiftCardView
                    key={booking.bookingId}
                    booking={booking}
                    group={group}
                    now={now}
                    offer={offers.get(booking.bookingId) ?? null}
                  />
                ))}
              </section>
            ))
          )}
          {list.past.length > 0 ? (
            <details className="past-shifts">
              <summary className="grp">Past shifts · {list.past.length}</summary>
              {list.past.map((booking) => (
                <PastShiftRow key={booking.bookingId} booking={booking} />
              ))}
            </details>
          ) : null}
        </>
      )}
    </StaffShell>
  );
}

/**
 * One booked shift. Which card it becomes is `myShiftCard()` (./model.ts),
 * which is `shiftCard()` from `@thc/domain` with its `past` told apart —
 * the order matters (a changed time outranks even Today) and it is asserted
 * there rather than decided by the order of the JSX.
 */
function ShiftCardView({
  booking,
  group,
  now,
  offer,
}: {
  booking: BookingRow;
  group: ShiftGroup;
  now: Date;
  /** ADR-0039: the open offer on this booking, if any. */
  offer: BookingOffer | null;
}) {
  const card = myShiftCard(booking, now);
  // The worker is still booked while an offer is open; the chip says it
  // is out there (wireframes/staff/offer-shift.html (d)).
  const offered = offer?.offerId && booking.status === 'confirmed' ? offer : null;
  const tone =
    card === 'today'
      ? 'today'
      : card === 'needs_ready' || card === 'reconfirm' || card === 'no_checkout'
        ? 'needs'
        : '';

  return (
    <div className={`mcard shift-card ${tone}`.trim()}>
      {/* The date leads; the chips follow it. */}
      <div className="card-head">
        <span className="when">
          <ShiftTime
            startsAt={booking.startsAt}
            endsAt={booking.endsAt}
            withDate
            withMonth={group === 'later' || group === 'earlier'}
            now={now}
          />
        </span>
        <span className="chips">
          <CardChips card={card} />
          {offered ? (
            offered.mode === 'office' ? (
              <Pill tone="amber">{COVER_CHIP}</Pill>
            ) : (
              <Pill tone="cyan">Offered</Pill>
            )
          ) : null}
        </span>
      </div>

      <Link className="t" href={`/shifts/${booking.bookingId}`}>
        {booking.eventTitle} · {booking.role}
      </Link>
      {/* §10.4: "the venue address sits under the name". The name is what a
          worker recognises; the full address is on the shift screen. */}
      <div className="venue">
        <span className="venue-name">{booking.venueName}</span>
        {booking.venueAddress ? <span className="venue-addr">{booking.venueAddress}</span> : null}
      </div>
      {/* Base rate only — never the charge rate, and never blended with the
          +12.07% holiday pay (§9.8). */}
      <div className="m">
        £{booking.payRate.toFixed(2)}/h
        {booking.dressCode ? ` · Dress code: ${booking.dressCode}` : ''}
      </div>

      {offered && offered.mode !== 'office' && offered.expiresAt ? (
        <p className="m">
          {offeredCardLine(offered.expiresAt)}
          <YourTimeAt at={offered.expiresAt} />
        </p>
      ) : null}

      {card === 'no_checkout' ? <p className="m">{STATIC_SCREEN_COPY.no_checkout.title}</p> : null}

      {card === 'ended' ? (
        <p className="m">
          Not checked out yet? Do it on the shift screen before{' '}
          {formatTimeIn(checkOutClosesAt(booking), UK_ZONE)} (UK).
          <YourTimeAt at={checkOutClosesAt(booking)} withDate={false} />
        </p>
      ) : null}

      {card === 'not_checked_in' ? (
        <p className="m coral">No check-in was recorded for this shift. Contact the office.</p>
      ) : null}

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
          {/* Stage 2, `markReady` — the one action "I'm ready" has. Past
              12:00 the database answers `deadline_passed` (ADR-0034 §3), so
              the button says so rather than offering a press that can only
              fail. The moment is `readyDeadlinePassed()` from the domain. */}
          <ActionButton
            label="I’m ready for tomorrow"
            tone="primary"
            block
            disabled={readyDeadlinePassed(booking.startsAt, now)}
            disabledLabel={`The ${READY_DEADLINE_UK} deadline has passed`}
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
            <p className="m">Check-in and check-out are on the shift screen.</p>
          ) : (
            <>
              <p className="m">
                Reminder only — no deadline. Confirming tells the office you’re on your way.
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
      canCancelShift(booking.startsAt, now) ? (
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
                confirmLabel: 'Yes, cancel shift',
                keepLabel: 'Keep my shift',
              }}
            />
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The chips beside the date — one vocabulary per `MyShiftCard`. */
function CardChips({ card }: { card: MyShiftCard }) {
  switch (card) {
    case 'reconfirm':
      return (
        <>
          <Pill tone="amber">Time changed</Pill>
          <Pill>Awaiting</Pill>
        </>
      );
    case 'needs_ready':
      return <Pill tone="amber">Needs confirmation</Pill>;
    case 'today':
      return (
        <>
          <Pill tone="cyan">Today</Pill>
          <Pill tone="green">Confirmed</Pill>
        </>
      );
    case 'no_checkout':
      return (
        <Pill tone={STATIC_SCREEN_COPY.no_checkout.tone}>
          {STATIC_SCREEN_COPY.no_checkout.badge}
        </Pill>
      );
    case 'ended':
      return <Pill>Ended</Pill>;
    case 'not_checked_in':
      return <Pill tone="coral">Not checked in</Pill>;
    case 'confirmed':
      return <Pill tone="green">Confirmed</Pill>;
  }
}

/**
 * One line of history: the date, what it was, and how it ended. `worked`
 * reads Worked; a `confirmed` booking whose check-out window has closed was
 * never checked into, and says so rather than "Confirmed" (see
 * `myShiftCard()`). The shift screen behind it holds the times and pay.
 */
function PastShiftRow({ booking }: { booking: BookingRow }) {
  return (
    <Link className="past-row" href={`/shifts/${booking.bookingId}`}>
      <span className="past-date mono">
        {formatDateIn(booking.startsAt, UK_ZONE, { weekday: 'short' })}
      </span>
      <span className="past-what">
        <span className="past-title">
          {booking.eventTitle} · {booking.role}
        </span>
        <span className="past-venue">{booking.venueName}</span>
      </span>
      {booking.status === 'worked' ? <Pill>Worked</Pill> : <Pill tone="coral">Not checked in</Pill>}
    </Link>
  );
}
