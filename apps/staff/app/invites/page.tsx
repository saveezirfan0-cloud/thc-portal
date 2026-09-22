import Link from 'next/link';
import { EmptyState, Pill } from '@thc/ui';
import { formatDistance } from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { acceptInvite, declineInvite } from '../actions';
import { loadBookings } from '../data';
import '../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invites · THC Staff' };

/**
 * Invites — Scope §10.4, wireframes/staff/invites.html.
 *
 * Personal invitations with Accept and Decline, each behind a confirm
 * dialog. Three rules decide what a card may say:
 *
 *   - the DRESS CODE is shown, so the worker can judge the shift before
 *     committing (confirmed 08.09.2026);
 *   - the on-site contact and the break policy are NOT, until it is
 *     accepted — `staff_bookings()` returns null for both while a booking is
 *     `invited`, so this screen could not leak them if it tried;
 *   - invitations have no deadline and are never withdrawn by auto-assign
 *     (§3.6). What removes one is the worker answering it, somebody else
 *     confirming first, or the event ending (RULE-16).
 */
export default async function Page() {
  const bookings = await loadBookings();
  const invites = bookings.filter((b) => b.status === 'invited');
  const shifts = bookings.filter((b) => b.status === 'confirmed').length;

  return (
    <StaffShell title="Invites" active="/invites" shifts={shifts} invites={invites.length}>
      {invites.length === 0 ? (
        <EmptyState>
          <h3>No open invitations</h3>
          New invitations arrive as notifications.
        </EmptyState>
      ) : (
        invites.map((invite) => (
          <div className="mcard" key={invite.bookingId}>
            <div className="card-head">
              <Pill tone="cyan">Invited</Pill>
              {invite.distanceKm !== null ? (
                <span className="km">{formatDistance(invite.distanceKm)}</span>
              ) : null}
              <span className="right">
                <ShiftTime startsAt={invite.startsAt} endsAt={invite.endsAt} withDate />
              </span>
            </div>
            <Link className="t" href={`/invites/${invite.bookingId}`}>
              {invite.eventTitle} · {invite.role}
            </Link>
            <div className="m">
              {invite.venueName}, {invite.venueAddress}
            </div>
            <div className="m">
              £{invite.payRate.toFixed(2)}/h
              {invite.dressCode ? ` · Dress code: ${invite.dressCode}` : ''}
            </div>
            <div className="card-actions">
              <ActionButton
                label="Decline"
                block
                action={declineInvite.bind(null, invite.bookingId)}
                confirm={{
                  title: 'Decline this invitation?',
                  body: 'Declining has no effect on your show-rate. The invitation moves to Closed and leaves your list. You can still apply for this shift on Radar later if it’s open.',
                  confirmLabel: 'Decline',
                  keepLabel: 'Keep it',
                }}
                tone="danger"
              />
              <ActionButton
                label="Accept"
                tone="primary"
                block
                action={acceptInvite.bind(null, invite.bookingId)}
                confirm={{
                  title: 'Accept this shift?',
                  body: `You’ll be booked for ${invite.eventTitle} · ${invite.role}. Any other invitation that overlaps this time will be withdrawn automatically. You’ll need to press “I’m ready” by 12:00 the day before.`,
                  confirmLabel: 'Accept shift',
                  keepLabel: 'Not now',
                }}
              />
            </div>
          </div>
        ))
      )}

      <p className="note xs">
        Invitations don’t expire — but the slot goes to the first person who confirms. An invitation
        disappears on its own once its event has ended.
      </p>
    </StaffShell>
  );
}
