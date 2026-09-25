import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pill } from '@thc/ui';
import { formatDistance, formatHours, sectionHours } from '@thc/domain';
import { StaffShell } from '../../../_components/StaffShell';
import { ShiftTime } from '../../../_components/ShiftTime';
import { ActionButton } from '../../../_components/ActionButton';
import { takeOfferedShift } from '../../../actions';
import { loadBookings, openInvites, shiftsBadge } from '../../../data';
import { RadarMap } from '../../RadarMap';
import { TAKE_BUTTON, TAKE_NOTE, UP_FOR_GRABS, ukDateTime } from '../../../shifts/offers';
import { loadOpenOffers } from '../../../shifts/offers-data';
import '../../../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Up for grabs · THC Staff' };

/**
 * One offered shift — ADR-0039, docs/18 §4,
 * `wireframes/staff/offer-shift.html` (i).
 *
 * Another worker offered this shift up; taking it books the worker at once
 * — a confirmed shift, not an application — so the note above the button
 * says so, and a success lands on the shift itself. The row comes from
 * `staff_open_offers()`, which applies RULE-17's visibility and never
 * returns who offered it; an offer this worker may not see is a 404, like
 * any other shift that is not theirs to take. The button re-checks every
 * hard gate under the section lock (`take_offered_shift()`), and each
 * refusal is answered in Radar's existing words (wireframe (j)).
 *
 * The dress code is shown before the worker decides; the on-site contact
 * and the break policy appear once booked, on the shift screen (§3.2).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [offers, bookings] = await Promise.all([loadOpenOffers(id), loadBookings()]);
  const offer = offers.find((o) => o.offerId === id);
  if (!offer) notFound();

  const hours = sectionHours({ startsAt: offer.startsAt, endsAt: offer.endsAt });

  return (
    <StaffShell
      title={`${offer.eventTitle} · ${offer.role}`}
      sub={<Link href="/radar">‹ Radar</Link>}
      active="/radar"
      shifts={shiftsBadge(bookings)}
      invites={openInvites(bookings).length}
    >
      <div className="card-head">
        <Pill tone="cyan">{UP_FOR_GRABS}</Pill>
        <span className="km">{formatDistance(offer.distanceKm)}</span>
        <span className="right mono sm muted">{offer.eventDate}</span>
      </div>

      <div className="card-head">
        <span className="detail-hours">
          <ShiftTime startsAt={offer.startsAt} endsAt={offer.endsAt} />
        </span>
        <span className="right sm muted">
          {formatHours(hours)} · £{offer.payRate.toFixed(2)}/h
        </span>
      </div>

      <div className="kvs">
        <div className="kv">
          <span className="k">Venue</span>
          <span className="v">
            {offer.venueName}, {offer.venueAddress}
          </span>
        </div>
        <div className="kv">
          <span className="k">Dress code</span>
          <span className="v">
            <b>{offer.dressCode || 'Not specified'}</b>
          </span>
        </div>
        <div className="kv">
          <span className="k">Rate</span>
          <span className="v">£{offer.payRate.toFixed(2)} per hour · base rate</span>
        </div>
        <div className="kv">
          <span className="k">Open until</span>
          <span className="v">{ukDateTime(offer.expiresAt)} (UK time)</span>
        </div>
      </div>

      <RadarMap shift={offer} />

      <p className="note xs">{TAKE_NOTE}</p>

      <ActionButton
        label={TAKE_BUTTON}
        tone="primary"
        block
        size="lg"
        action={takeOfferedShift.bind(null, offer.offerId)}
      />
    </StaffShell>
  );
}
