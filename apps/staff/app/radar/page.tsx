import Link from 'next/link';
import { EmptyState, Pill } from '@thc/ui';
import {
  RADAR_GROUP_LABEL,
  UK_ZONE,
  explainLimit,
  formatDateTimeIn,
  formatDistance,
  openSlots,
  radarGroups,
  sectionHours,
} from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { LoadProblem } from '../_components/LoadProblem';
import { withdrawApplication } from '../actions';
import { loadBookings, loadOpenShifts, loadWeekMeter, openInvites, shiftsBadge } from '../data';
import type { OpenShift } from '../data';
import { WeekMeter } from './WeekMeter';
import { weekLabel } from './model';
import { UP_FOR_GRABS, ukShortDateTime } from '../shifts/offers';
import { YourTimeAt } from '../shifts/YourTimeAt';
import { loadOpenOffers } from '../shifts/offers-data';
import type { OpenOffer } from '../shifts/offers-data';
import '../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Radar · THC Staff' };

/**
 * Radar — Scope §10.4, wireframes/staff/radar.html.
 *
 * Open shifts nearby right now, closest first, with a km badge. The grouping
 * is RULE-17 made visible: clients the worker is qualified at appear under
 * "You've worked here before" from the moment the role opens; other clients
 * surface only once the qualified pool for that role has been exhausted. The
 * exhaustion test is `radar_wave1_exhausted()` in SQL, reading the same
 * candidate function auto-assign reads, so self-apply cannot bypass the
 * priority the invitations enforce.
 *
 * An applied shift does not disappear. It leaves its wave group and joins
 * "Applied", and stays there until it resolves: into Shifts once confirmed
 * (N10), or off Radar when the role fills without them (N10c).
 *
 * The strip at the top is the CURRENT Mon–Sun week in Europe/London —
 * `staff_week_meter()` — not the week of whichever shift happens to be
 * listed first. A worker with nothing open until next week still reads
 * this week's hours under "This week".
 */
export default async function Page() {
  const [
    { rows: shifts, problem },
    { rows: bookings, problem: bookingsProblem },
    { row: meter },
    { rows: offers, problem: offersProblem },
  ] = await Promise.all([
    loadOpenShifts(),
    loadBookings(),
    loadWeekMeter(),
    // ADR-0046: offered shifts this worker may take — RULE-17 visibility,
    // decided in SQL, and never the offerer.
    loadOpenOffers(),
  ]);
  const groups = radarGroups(shifts);
  const applications = new Map(
    bookings.filter((b) => b.status === 'applied').map((b) => [b.shiftId, b.bookingId] as const),
  );

  const empty =
    !problem &&
    !offersProblem &&
    offers.length === 0 &&
    groups.qualified.length === 0 &&
    groups.other.length === 0 &&
    groups.applied.length === 0;

  return (
    <StaffShell
      title="Radar"
      active="/radar"
      {...(bookingsProblem
        ? {}
        : { shifts: shiftsBadge(bookings), invites: openInvites(bookings).length })}
    >
      {problem ? (
        // Audit D18: a failed read is not "Nothing open nearby".
        <LoadProblem what="open shifts" />
      ) : null}
      {meter ? (
        <WeekMeter
          label={`This week (${weekLabel(meter.weekStart, meter.weekEnd)})`}
          bookedHours={meter.bookedHours}
          capHours={meter.capHours}
          {...(meter.roles.length > 0
            ? { above: <span className="xs muted">{meter.roles.join(' · ')}</span> }
            : {})}
        />
      ) : null}
      {empty ? (
        <EmptyState>
          <h3>Nothing open nearby</h3>
          Radar shows open shifts for your roles. New ones are added regularly.
        </EmptyState>
      ) : null}

      {offersProblem ? (
        // Audit D18: an unread offer list is not "nothing up for grabs".
        <LoadProblem what="shifts up for grabs" />
      ) : null}
      {offers.length > 0 ? (
        <>
          <div className="grp cyan">{UP_FOR_GRABS}</div>
          {offers.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} />
          ))}
        </>
      ) : null}

      {groups.qualified.length > 0 ? (
        <>
          <div className="grp purple">{RADAR_GROUP_LABEL.qualified}</div>
          {groups.qualified.map((shift) => (
            <RadarCard key={shift.shiftId} shift={shift} />
          ))}
        </>
      ) : null}

      {groups.other.length > 0 ? (
        <>
          <div className="grp">{RADAR_GROUP_LABEL.other}</div>
          <p className="xs muted">
            Shown only once every worker qualified for this role at that client has been invited.
          </p>
          {groups.other.map((shift) => (
            <RadarCard key={shift.shiftId} shift={shift} />
          ))}
        </>
      ) : null}

      {groups.applied.length > 0 ? (
        <>
          <div className="grp purple">{RADAR_GROUP_LABEL.applied}</div>
          {groups.applied.map((shift) => (
            <RadarCard
              key={shift.shiftId}
              shift={shift}
              {...(applications.get(shift.shiftId)
                ? { bookingId: applications.get(shift.shiftId)! }
                : {})}
            />
          ))}
          <p className="xs muted" style={{ textAlign: 'center' }}>
            Applied shifts stay here until they resolve — into Shifts once confirmed, or off Radar
            when the role fills.
          </p>
        </>
      ) : null}
    </StaffShell>
  );
}

/**
 * One offered shift (ADR-0046, wireframes/staff/offer-shift.html (h)). A
 * confirmed booking at once if taken, so it opens the offer's own detail,
 * not the open shift's. The base rate only; never who offered it.
 */
function OfferCard({ offer }: { offer: OpenOffer }) {
  return (
    <div className="mcard">
      <div className="card-head">
        <Pill tone="cyan">{UP_FOR_GRABS}</Pill>
        <span className="right km">{formatDistance(offer.distanceKm)}</span>
      </div>
      <Link className="t" href={`/radar/offers/${offer.offerId}`}>
        {offer.eventTitle} · {offer.role}
      </Link>
      <div className="m">
        {offer.venueName} · <ShiftTime startsAt={offer.startsAt} endsAt={offer.endsAt} withDate />
      </div>
      <div className="m">
        £{offer.payRate.toFixed(2)}/h
        {offer.dressCode ? ` · Dress code: ${offer.dressCode}` : ''} · open until{' '}
        {ukShortDateTime(offer.expiresAt)} (UK time)
        {/* §1.8: a scheduled close — the viewer's own clock too, when it differs. */}
        <YourTimeAt at={offer.expiresAt} />
      </div>
      <Link className="btn outline block" href={`/radar/offers/${offer.offerId}`}>
        View &amp; take
      </Link>
    </div>
  );
}

function RadarCard({ shift, bookingId }: { shift: OpenShift; bookingId?: string }) {
  const applied = Boolean(shift.appliedAt);
  return (
    <div className={`mcard${applied ? ' applied' : shift.hoursLimit ? ' muted' : ''}`}>
      <div className="card-head">
        {applied ? <Pill tone="purple">Applied</Pill> : null}
        {!applied && shift.qualified ? <Pill tone="purple">Worked here before</Pill> : null}
        {shift.hoursLimit ? <Pill tone="coral">Limit Reached</Pill> : null}
        <span className="right km">{formatDistance(shift.distanceKm)}</span>
      </div>
      <Link className="t" href={`/radar/${shift.shiftId}`}>
        {shift.eventTitle} · {shift.role}
      </Link>
      <div className="m">
        {shift.venueName} · <ShiftTime startsAt={shift.startsAt} endsAt={shift.endsAt} withDate />
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
          })}
        </p>
      ) : null}
      {applied ? (
        <>
          <p className="m">
            Applied {formatDateTimeIn(shift.appliedAt!, UK_ZONE)} (UK) · you’ll get a push either
            way.
          </p>
          {bookingId ? (
            <ActionButton
              label="Withdraw application"
              tone="ghost"
              size="sm"
              block
              action={withdrawApplication.bind(null, bookingId)}
              confirm={{
                title: 'Withdraw this application?',
                body: 'The shift goes back on Radar and you can apply again while it stays open. This does not affect your show-rate.',
                confirmLabel: 'Withdraw',
                keepLabel: 'Keep it',
              }}
            />
          ) : null}
        </>
      ) : shift.hoursLimit ? (
        // RULE-20: the wireframe's disabled button, not a live link. The
        // title above still opens the detail and its arithmetic.
        <button type="button" className="btn block" disabled>
          Limit Reached
        </button>
      ) : (
        <Link className="btn outline block" href={`/radar/${shift.shiftId}`}>
          View &amp; apply
        </Link>
      )}
    </div>
  );
}
