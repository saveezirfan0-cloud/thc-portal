import Link from 'next/link';
import { EmptyState, Pill } from '@thc/ui';
import {
  RADAR_GROUP_LABEL,
  UK_ZONE,
  capMeter,
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
import { withdrawApplication } from '../actions';
import { loadBookings, loadOpenShifts, openInvites } from '../data';
import type { OpenShift } from '../data';
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
 */
export default async function Page() {
  const [shifts, bookings] = await Promise.all([loadOpenShifts(), loadBookings()]);
  const groups = radarGroups(shifts);
  const applications = new Map(
    bookings.filter((b) => b.status === 'applied').map((b) => [b.shiftId, b.bookingId] as const),
  );

  const empty =
    groups.qualified.length === 0 && groups.other.length === 0 && groups.applied.length === 0;
  // §10.4's header strip: "This week (Mon 14 – Sun 20) · 8 h of 20 h". Any
  // row carries the figures for its own week; the soonest is this week's.
  const first = shifts[0];
  const meter = first
    ? capMeter({
        weekStart: first.weekStart,
        bookedHours: first.bookedHours,
        capHours: first.capHours,
        shiftHours: 0,
      })
    : null;

  return (
    <StaffShell
      title="Radar"
      active="/radar"
      shifts={bookings.filter((b) => b.status === 'confirmed' || b.status === 'worked').length}
      invites={openInvites(bookings).length}
    >
      {meter ? (
        <div className="note xs">
          This week · <b>{meter}</b>. Your weekly limit is calculated from your verified documents
          and is never typed by anyone.
        </div>
      ) : null}
      {empty ? (
        <EmptyState>
          <h3>Nothing open nearby</h3>
          Radar shows open shifts for your roles. New ones are added regularly.
        </EmptyState>
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
      ) : (
        <Link className="btn outline block" href={`/radar/${shift.shiftId}`}>
          View &amp; apply
        </Link>
      )}
    </div>
  );
}
