import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Pill } from '@thc/ui';
import {
  explainLimit,
  formatAllocationPair,
  formatDistance,
  formatHours,
  openSlots,
  sectionHours,
} from '@thc/domain';
import { StaffShell } from '../../_components/StaffShell';
import { ShiftTime } from '../../_components/ShiftTime';
import { ActionButton } from '../../_components/ActionButton';
import { applyForShift } from '../../actions';
import { findOpenShift, loadBookings, openInvites, shiftsBadge } from '../../data';
import { RadarMap } from '../RadarMap';
import { WeekMeter } from '../WeekMeter';
import { dayLabel } from '../model';
import '../../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Open shift · THC Staff' };

/**
 * One open shift — Scope §10.4, wireframes/staff/radar.html.
 *
 * The dress code is shown BEFORE the worker decides, for the same reason as
 * on an invitation. The on-site contact and the break policy are not: they
 * appear once booked, on the shift screen (§3.2, §5.2b). Applying is not a
 * booking — the office or auto-assign still confirms it — and the button
 * re-checks live availability, so "Sorry, this shift is now full" is a real
 * answer from the server rather than a stale count on this page.
 *
 * Every shift gets the map block and the week meter — "Week of Mon 14 with
 * this shift · 13 h of 20 h" — not only a Limit Reached one: the meter is
 * how a worker sees a shift that fits, and how close it comes.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shift = await findOpenShift(id);
  if (!shift) notFound();

  const bookings = await loadBookings();
  const hours = sectionHours({ startsAt: shift.startsAt, endsAt: shift.endsAt });
  const open = openSlots({
    confirmed: shift.confirmedCount,
    invited: 0,
    headcount: shift.headcount,
    buffer: shift.buffer,
  });

  return (
    <StaffShell
      title={`${shift.eventTitle} · ${shift.role}`}
      sub={<Link href="/radar">‹ Radar</Link>}
      active="/radar"
      shifts={shiftsBadge(bookings)}
      invites={openInvites(bookings).length}
    >
      <div className="card-head">
        {shift.qualified ? <Pill tone="purple">Worked here before</Pill> : null}
        <span className="km">{formatDistance(shift.distanceKm)}</span>
        <span className="right mono sm muted">{shift.eventDate}</span>
      </div>

      <div className="card-head">
        <span className="detail-hours">
          <ShiftTime startsAt={shift.startsAt} endsAt={shift.endsAt} />
        </span>
        <span className="right sm muted">
          {formatHours(hours)} · £{shift.payRate.toFixed(2)}/h
        </span>
      </div>

      <div className="kvs">
        <div className="kv">
          <span className="k">Venue</span>
          <span className="v">
            {shift.venueName}, {shift.venueAddress}
          </span>
        </div>
        <div className="kv">
          <span className="k">Dress code</span>
          <span className="v">
            <b>{shift.dressCode || 'Not specified'}</b>
          </span>
        </div>
        <div className="kv">
          <span className="k">Rate</span>
          <span className="v">£{shift.payRate.toFixed(2)} per hour · base rate</span>
        </div>
        <div className="kv">
          {/* Seats, not the invitation target: the buffer is an
              over-invitation allowance and is shown absolute (§3.2). */}
          <span className="k">Open</span>
          <span className="v">
            {open} of {formatAllocationPair(shift.headcount, shift.buffer)} still to fill
          </span>
        </div>
      </div>

      <RadarMap shift={shift} />

      {shift.bookedHours !== null ? (
        <WeekMeter
          label={
            shift.weekStart
              ? `Week of ${dayLabel(shift.weekStart)} with this shift`
              : 'This week with this shift'
          }
          bookedHours={shift.bookedHours}
          capHours={shift.capHours}
          shiftHours={hours}
          {...(shift.hoursLimit
            ? {
                below: (
                  <>
                    {explainLimit({
                      weekStart: shift.weekStart,
                      bookedHours: shift.bookedHours,
                      capHours: shift.capHours,
                      shiftHours: hours,
                    }) ??
                      `This ${formatHours(hours)} shift would take you over your weekly hours limit for that Mon–Sun week.`}{' '}
                    The limit is calculated from your verified documents and cannot be changed in
                    the app.
                  </>
                ),
              }
            : {})}
        />
      ) : null}

      {shift.hoursLimit ? (
        <Alert tone="coral">
          <b>Limit Reached.</b> Applying is blocked for the Mon–Sun week this shift falls in
          (RULE-20).
        </Alert>
      ) : (
        <p className="note xs">
          On-site contact and break policy appear once you’re booked, on the shift screen. Applying
          isn’t a booking — the office (or auto-assign) confirms it and you’ll get a push either
          way.
        </p>
      )}

      {shift.appliedAt ? (
        <Pill tone="purple">Applied — waiting for the office</Pill>
      ) : (
        <ActionButton
          label="Apply for this shift"
          tone="primary"
          block
          size="lg"
          disabled={shift.hoursLimit}
          disabledLabel="Limit Reached"
          action={applyForShift.bind(null, shift.shiftId)}
        />
      )}
    </StaffShell>
  );
}
