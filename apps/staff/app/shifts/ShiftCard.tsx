import Link from 'next/link';
import { Alert, Pill } from '@thc/ui';
import { canCancelShift, shiftCard } from '@thc/domain';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { cancelShift, confirmToday, markReady, reconfirm } from '../actions';
import type { BookingRow } from '../data';
import { CancelUntil } from './CancelUntil';
import { CardCheckIn } from './CardCheckIn';
import { READY_DEADLINE_LINE, describeReconfirm } from './list';
import type { VenuePoint } from './venue';

/**
 * One booked shift on My shifts (§10.4, wireframes/staff/shifts.html).
 *
 * Which of the five cards it becomes is `shiftCard()` in `@thc/domain` —
 * the order matters (a changed time outranks even Today) and it is
 * asserted there rather than decided by the order of the JSX. What this
 * file decides is the pills, the copy and the buttons of each.
 */
export function ShiftCardView({
  booking,
  venue,
}: {
  booking: BookingRow;
  venue: VenuePoint | null;
}) {
  const card = shiftCard(booking);
  const tone =
    card === 'today' ? 'today' : card === 'needs_ready' || card === 'reconfirm' ? 'needs' : '';
  // Stage 3 belongs to a booking still awaiting the worker (§3.5); once
  // pressed, or once checked in (`worked`), the card carries check-in.
  const awaitingOnDay =
    card === 'today' && booking.status === 'confirmed' && !booking.onDayConfirmedAt;

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
        ) : card === 'past' && booking.noCheckoutOpen ? (
          <Pill tone="coral">No check-out</Pill>
        ) : awaitingOnDay ? (
          <Pill tone="amber">Not confirmed today</Pill>
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
          <p className="m coral">{describeReconfirm(booking.reconfirmReason)}</p>
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
            {READY_DEADLINE_LINE.before}
            <b>{READY_DEADLINE_LINE.deadline}</b> — or you’ll be removed from this shift.
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
        awaitingOnDay ? (
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
        ) : (
          // §10.4: "today's shift carries check-in inside the card". Once
          // checked in the shift screen carries the on-shift state (§5).
          <CardCheckIn
            bookingId={booking.bookingId}
            startsAt={booking.startsAt.toISOString()}
            venue={venue ? { lat: venue.lat, lng: venue.lng } : null}
            radiusM={venue?.radiusM ?? 0}
          />
        )
      ) : null}

      {card === 'past' && booking.noCheckoutOpen ? (
        <p className="m">
          We didn’t receive your check-out for this shift — the office is following up with you
          directly.
        </p>
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
        <div className="row">
          <CancelUntil startsAt={booking.startsAt} />
          <span className="ml-auto">
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
