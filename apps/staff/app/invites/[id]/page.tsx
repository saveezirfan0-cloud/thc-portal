import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Pill } from '@thc/ui';
import { explainLimit, formatDistance, formatHours, sectionHours } from '@thc/domain';
import { StaffShell } from '../../_components/StaffShell';
import { ShiftTime } from '../../_components/ShiftTime';
import { ActionButton } from '../../_components/ActionButton';
import { acceptInvite, declineInvite } from '../../actions';
import { findBooking, loadBookings, openInvites, overlapWarning, shiftsBadge } from '../../data';
import '../../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitation · THC Staff' };

/**
 * One invitation — Scope §10.4, wireframes/staff/invites.html.
 *
 * The two withheld rows are rendered as rows, struck through and labelled
 * "Shown after you accept", rather than omitted. Leaving them out would read
 * as an event with no on-site contact and no break policy; showing them
 * empty tells the worker there is something there and when they get it.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invite = await findBooking(id);
  if (!invite || invite.status !== 'invited') notFound();

  const all = await loadBookings();
  const hours = sectionHours({ startsAt: invite.startsAt, endsAt: invite.endsAt });
  const limit = invite.hoursLimit
    ? explainLimit({
        weekStart: invite.weekStart,
        bookedHours: invite.bookedHours,
        capHours: invite.capHours,
        shiftHours: hours,
      })
    : null;
  const overlap = overlapWarning(invite, all);

  return (
    <StaffShell
      title={`${invite.eventTitle} · ${invite.role}`}
      sub={<Link href="/invites">‹ Invites</Link>}
      active="/invites"
      shifts={shiftsBadge(all)}
      invites={openInvites(all).length}
    >
      <div className="card-head">
        <Pill tone="cyan">Invited</Pill>
        {invite.hoursLimit ? <Pill tone="coral">Limit Reached</Pill> : null}
        <Pill>{invite.venueName}</Pill>
        <span className="right mono sm muted">{invite.eventDate}</span>
      </div>

      <div className="card-head">
        <span className="detail-hours">
          <ShiftTime startsAt={invite.startsAt} endsAt={invite.endsAt} />
        </span>
        <span className="right sm muted">
          {formatHours(hours)} · £{invite.payRate.toFixed(2)}/h
        </span>
      </div>

      <div className="kvs">
        <div className="kv">
          <span className="k">Venue</span>
          <span className="v">
            {invite.venueName}, {invite.venueAddress}
            {invite.distanceKm !== null ? ` · ${formatDistance(invite.distanceKm)}` : ''}
          </span>
        </div>
        <div className="kv">
          <span className="k">Dress code</span>
          <span className="v">
            <b>{invite.dressCode || 'Not specified'}</b>
          </span>
        </div>
        <div className="kv">
          <span className="k">Rate</span>
          <span className="v">£{invite.payRate.toFixed(2)} per hour · base rate</span>
        </div>
        <div className="kv">
          <span className="k">Role window</span>
          <span className="v">Your hours — the event itself may run longer.</span>
        </div>
        {/* Withheld until acceptance (§10.4, §3.2, §5.2b). The loader returns
            null for both, so there is nothing here to print by accident. */}
        <div className="kv off">
          <span className="k">On-site contact</span>
          <span className="v">Shown after you accept</span>
        </div>
        <div className="kv off">
          <span className="k">Breaks</span>
          <span className="v">Shown after you accept</span>
        </div>
      </div>

      {overlap ? <Alert tone="amber">{overlap}. Only your confirmed bookings count.</Alert> : null}

      {invite.hoursLimit ? (
        <Alert tone="coral">
          <b>Limit Reached.</b> {limit} The limit is calculated from your verified documents and
          can’t be changed in the app.
        </Alert>
      ) : (
        <Alert tone="cyan">
          Invitations don’t expire — but the slot goes to the first person who confirms. If you
          accept, you’ll be asked to press “I’m ready” by 12:00 the day before.
        </Alert>
      )}

      <div className="card-actions">
        <ActionButton
          label="Decline"
          block
          size="lg"
          tone="danger"
          action={declineInvite.bind(null, invite.bookingId)}
          confirm={{
            title: 'Decline this invitation?',
            body: 'Declining has no effect on your show-rate. The invitation moves to Closed and leaves your list. You can still apply for this shift on Radar later if it’s open.',
            confirmLabel: 'Decline',
            keepLabel: 'Keep it',
          }}
        />
        <ActionButton
          label="Accept"
          tone="primary"
          block
          size="lg"
          disabled={invite.hoursLimit}
          disabledLabel="Limit Reached"
          action={acceptInvite.bind(null, invite.bookingId)}
          confirm={{
            title: 'Accept this shift?',
            body: `You’ll be booked for ${invite.eventTitle} · ${invite.role} at ${invite.venueName}. Any other invitation that overlaps this time will be withdrawn automatically.`,
            confirmLabel: 'Accept shift',
            keepLabel: 'Not now',
          }}
        />
      </div>
    </StaffShell>
  );
}
