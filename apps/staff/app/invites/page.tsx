import Link from 'next/link';
import { EmptyState, Pill } from '@thc/ui';
import { explainLimit, formatDistance, sectionHours } from '@thc/domain';
import { StaffShell } from '../_components/StaffShell';
import { ShiftTime } from '../_components/ShiftTime';
import { ActionButton } from '../_components/ActionButton';
import { LoadProblem } from '../_components/LoadProblem';
import { acceptInvite, declineInvite } from '../actions';
import { loadBookings, openInvites, overlapWarning, shiftsBadge } from '../data';
import { invitedAgo } from './ago';
import '../staff-app.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invites · THC Staff' };

/**
 * Invites — Scope §10.4, wireframes/staff/invites.html.
 *
 * Personal invitations with Accept and Decline, each behind a confirm
 * dialog. Four rules decide what a card may say and whether it is here:
 *
 *   - the DRESS CODE is shown, so the worker can judge the shift before
 *     committing (confirmed 08.09.2026);
 *   - the on-site contact and the break policy are NOT, until it is
 *     accepted — `staff_bookings()` returns null for both while a booking is
 *     `invited`, so this screen could not leak them if it tried;
 *   - RULE-20: where accepting would take the worker over their weekly limit
 *     for that Mon–Sun week, Accept reads "Limit Reached" and the card
 *     carries the arithmetic. `accept_invite` refuses it too — a hard gate
 *     that exists only on the screen is not a hard gate;
 *   - RULE-16: an open invitation disappears on its own once its event has
 *     ended, whatever its row still says, and a cancelled event's invitation
 *     goes the moment N12 lands;
 *   - §3.4: where the invitation collides with a CONFIRMED booking — the
 *     windows intersect, or a different venue is under two hours away — the
 *     card carries the amber "Overlaps your confirmed …" line before the
 *     worker taps. `accept_invite` still refuses it; the line is a warning.
 */
export default async function Page() {
  const { rows: bookings, problem } = await loadBookings();
  const invites = openInvites(bookings);
  const now = new Date();

  return (
    <StaffShell
      title="Invites"
      active="/invites"
      {...(problem ? {} : { shifts: shiftsBadge(bookings), invites: invites.length })}
    >
      {problem ? (
        // Audit D18: a failed read is not "No open invitations".
        <LoadProblem what="your invitations" />
      ) : invites.length === 0 ? (
        <EmptyState>
          <h3>No open invitations</h3>
          New invitations arrive as notifications.
        </EmptyState>
      ) : (
        invites.map((invite) => {
          const limit = invite.hoursLimit
            ? explainLimit({
                weekStart: invite.weekStart,
                bookedHours: invite.bookedHours,
                capHours: invite.capHours,
                shiftHours: sectionHours(invite),
              })
            : null;
          const overlap = overlapWarning(invite, bookings);
          return (
            <div className={`mcard${invite.hoursLimit ? ' muted' : ''}`} key={invite.bookingId}>
              <div className="card-head">
                {invite.hoursLimit ? (
                  <Pill tone="coral">Limit Reached</Pill>
                ) : (
                  <Pill tone="cyan">{invitedAgo(invite.createdAt, now)}</Pill>
                )}
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
              {overlap ? <div className="m amber">{overlap}</div> : null}
              {limit ? <div className="m">{limit}</div> : null}
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
                  disabled={invite.hoursLimit}
                  disabledLabel="Limit Reached"
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
          );
        })
      )}

      <p className="note xs">
        Invitations don’t expire — but the slot goes to the first person who confirms. An invitation
        disappears on its own once its event has ended.
      </p>
    </StaffShell>
  );
}
