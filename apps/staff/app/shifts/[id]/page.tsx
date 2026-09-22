import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Button, Pill } from '@thc/ui';
import {
  STATIC_SCREEN_ACTION,
  STATIC_SCREEN_CONTACT,
  STATIC_SCREEN_COPY,
  formatDistance,
  formatHours,
  sectionHours,
  staticScreenCase,
} from '@thc/domain';
import { StaffShell } from '../../_components/StaffShell';
import { ShiftTime } from '../../_components/ShiftTime';
import { findBooking, loadBookings } from '../../data';
import '../../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shift · THC Staff' };

/**
 * One booked shift — Scope §10.4.
 *
 * Two screens in one route, and which one renders is `staticScreenCase()`:
 *
 *   - Tapping into a shift the office has cancelled (N12), withdrawn the
 *     booking on (N10b), or locked for a No check-out violation (RULE-02)
 *     opens a STATIC MESSAGE — no map, no check-in/check-out, no breaks
 *     block. The three carry distinct copy, and all three the same contact
 *     line and single button (confirmed against the approved design and by
 *     THC, correspondence 01.09.2026).
 *   - Otherwise the ordinary details, including the two things an invitation
 *     withheld: the on-site contact and the break policy (§3.2, §5.2b).
 *
 * The check-in and check-out controls, the map and the breaks block belong
 * to §5 and arrive with that screen; what is here is what §10.4 owns.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await findBooking(id);
  if (!booking) notFound();

  const all = await loadBookings();
  const shell = {
    active: '/shifts' as const,
    shifts: all.filter((b) => b.status === 'confirmed').length,
    invites: all.filter((b) => b.status === 'invited').length,
  };

  const dead = staticScreenCase(booking);
  if (dead) {
    const copy = STATIC_SCREEN_COPY[dead];
    return (
      <StaffShell title={`${booking.eventTitle} · ${booking.role}`} {...shell}>
        <div className="static-screen">
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
          <p className="muted xs">{STATIC_SCREEN_CONTACT}</p>
          <Link className="btn primary" href="/shifts">
            {STATIC_SCREEN_ACTION}
          </Link>
        </div>
      </StaffShell>
    );
  }

  const hours = sectionHours({ startsAt: booking.startsAt, endsAt: booking.endsAt });

  return (
    <StaffShell
      title={`${booking.eventTitle} · ${booking.role}`}
      sub={<Link href="/shifts">‹ Shifts</Link>}
      {...shell}
    >
      <div className="card-head">
        <Pill tone="green">Confirmed</Pill>
        <Pill>{booking.venueName}</Pill>
        <span className="right mono sm muted">{booking.eventDate}</span>
      </div>

      <div className="card-head">
        <span className="detail-hours">
          <ShiftTime startsAt={booking.startsAt} endsAt={booking.endsAt} />
        </span>
        <span className="right sm muted">
          {formatHours(hours)} · £{booking.payRate.toFixed(2)}/h
        </span>
      </div>

      <div className="kvs">
        <div className="kv">
          <span className="k">Venue</span>
          <span className="v">
            {booking.venueName}, {booking.venueAddress}
            {booking.distanceKm !== null ? ` · ${formatDistance(booking.distanceKm)}` : ''}
          </span>
        </div>
        <div className="kv">
          <span className="k">Dress code</span>
          <span className="v">
            <b>{booking.dressCode || 'Not specified'}</b>
          </span>
        </div>
        {/* Both withheld on the invitation, and here as the free text the
            event carries — never split into name and phone fields (§3.2). */}
        <div className="kv">
          <span className="k">On-site contact</span>
          <span className="v">{booking.onsiteContact || 'Not given'}</span>
        </div>
        <div className="kv">
          <span className="k">Breaks</span>
          <span className="v">
            {booking.paysBreaks === null
              ? '—'
              : booking.paysBreaks
                ? 'Breaks are paid on this event.'
                : 'Breaks are unpaid and deducted from your hours (RULE-01).'}
          </span>
        </div>
        {booking.notes ? (
          <div className="kv">
            <span className="k">Instructions</span>
            <span className="v">{booking.notes}</span>
          </div>
        ) : null}
      </div>

      <Alert tone="cyan">
        Check-in, breaks and check-out arrive on this screen with §5. The times above are your own
        role’s hours — the event itself may run longer.
      </Alert>

      <Button disabled title="Arrives with the §5 check-in screen">
        Check in — verify GPS
      </Button>
    </StaffShell>
  );
}
