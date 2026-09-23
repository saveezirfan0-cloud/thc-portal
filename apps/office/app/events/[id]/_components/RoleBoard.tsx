import { Avatar, Panel, Pill } from '@thc/ui';
import {
  DEFAULT_WEIGHTS,
  type EventStatus,
  UK_ZONE,
  appliedAgo,
  canCancelBooking,
  formatAllocationPair,
  formatHours,
  formatTimeIn,
  roleBoardHeader,
  sectionHours,
  showsCandidatePools,
} from '@thc/domain';
import type { BoardBooking, BoardSection, BoardUnavailable } from '../board-data';
import { ApplicationActions } from './ApplicationActions';
import { BookingActions } from './BookingActions';

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** "blocked-compliance", not "blocked_compliance" (§3.3's own wording). */
const GATE_LABEL: Record<string, string> = {
  blocked: 'blocked — compliance',
  booked_elsewhere: 'booked elsewhere',
  hours_limit: 'hours limit reached',
  rtw_expired: 'right to work expired',
  self_cancelled: 'rejected — self-cancelled more than 72 h before the shift',
  do_not_return: 'do not return at this client',
  wrong_role: 'not signed off for this role',
};

function Person({ person, sub }: { person: BoardBooking | BoardUnavailable; sub: string }) {
  return (
    <>
      <Avatar name={person.name} />
      <div className="who">
        <div className="n">{person.name}</div>
        <div className="s">{sub}</div>
      </div>
    </>
  );
}

/**
 * One role section of the board — Scope §3.3.
 *
 * Sections are ordered by their own start time so the board reads like the
 * running order of the day, and the header counts CONFIRMED only: an
 * invitation fills nothing.
 */
export function RoleBoard({
  section,
  status,
  eventId,
  payrollExported,
}: {
  section: BoardSection;
  status: EventStatus;
  eventId: string;
  payrollExported: boolean;
}) {
  const startsAt = new Date(section.startsAt);
  const endsAt = new Date(section.endsAt);
  const counts = {
    confirmed: section.confirmed.length,
    invited: section.invited.length,
    headcount: section.headcount,
    buffer: section.buffer,
  };
  const showPools = showsCandidatePools(status, counts);

  return (
    <Panel
      flush
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <b>{section.roleName}</b>
          <span className="mono sm muted">
            {formatTimeIn(startsAt, UK_ZONE)} – {formatTimeIn(endsAt, UK_ZONE)} ·{' '}
            {formatHours(sectionHours({ startsAt, endsAt }))}
          </span>
          {/* Absolute buffer, never the total (§3.2). */}
          <Pill>{formatAllocationPair(section.headcount, section.buffer)}</Pill>
          <span className="mono sm">{roleBoardHeader(counts)}</span>
        </span>
      }
      actions={
        <span className="row sm muted" style={{ gap: 10 }}>
          {section.dressCode ? <span>{section.dressCode}</span> : null}
          <span className="mono">
            £{section.payRate.toFixed(2)} pay · £{section.chargeRate.toFixed(2)} charge
          </span>
          {section.autoAssign ? <Pill tone="purple">Auto-assign</Pill> : null}
        </span>
      }
    >
      <div className="sub">
        <div className="subh">
          Confirmed <span className="n">{section.confirmed.length}</span>
          <span className="right muted sm">
            the worker confirms in the app — no Confirm button here, only Withdraw
          </span>
        </div>
        {section.confirmed.length === 0 ? (
          <div className="prow muted">Nobody has confirmed yet.</div>
        ) : (
          section.confirmed.map((booking) => (
            <div className="prow" key={booking.bookingId}>
              <Person person={booking} sub={confirmedLine(booking, section.roleName)} />
              {booking.qualified ? (
                <Pill tone="cyan">Qualified — this client · {section.roleName}</Pill>
              ) : null}
              {booking.appliedAt ? <span className="applied">Applied</span> : null}
              {/* A no-show stays here, badged — never moved to its own list (§3.3). */}
              {booking.noShow ? <Pill tone="coral">No show</Pill> : null}
              {booking.reconfirmRequired ? <Pill tone="amber">Awaiting re-confirm</Pill> : null}
              <div className="right">
                <BookingActions
                  eventId={eventId}
                  bookingId={booking.bookingId}
                  noShow={booking.noShow}
                  confirmed
                  payrollExported={payrollExported}
                  // Checked in = `worked`, which §3.6 never cancels.
                  withdrawable={canCancelBooking(booking.status)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {showPools ? (
        <div className="sub">
          <div className="subh">
            Invited · awaiting response <span className="n">{section.invited.length}</span>
            <span className="right muted sm">
              invitations have no deadline and are never withdrawn by auto-assign (§3.6)
            </span>
          </div>
          {section.invited.length === 0 ? (
            <div className="prow muted">No invitations outstanding.</div>
          ) : (
            section.invited.map((booking) => (
              <div className="prow" key={booking.bookingId}>
                <Person person={booking} sub={invitedLine(booking)} />
                {booking.qualified ? (
                  <Pill tone="cyan">Qualified — this client · {section.roleName}</Pill>
                ) : null}
                {/* Already invited and also self-applied: the marker shows
                    here rather than duplicating them into the pool (§3.3). */}
                {booking.appliedAt ? (
                  <span className="applied">{appliedMarker(booking)}</span>
                ) : null}
                <div className="right">
                  <Pill tone="amber">Awaiting</Pill>
                  <BookingActions
                    eventId={eventId}
                    bookingId={booking.bookingId}
                    noShow={false}
                    confirmed={false}
                    payrollExported={payrollExported}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {showPools ? (
        <div className="sub">
          <div className="subh">
            Potential pool
            <span className="right muted sm">ranked · qualified first (RULE-17)</span>
          </div>
          <div className="legend">
            <span>Score =</span>
            <span>
              <b>{Math.round(DEFAULT_WEIGHTS.show * 100)}%</b> show-rate
            </span>
            <span>
              <b>{Math.round(DEFAULT_WEIGHTS.rating * 100)}%</b> client rating
            </span>
            <span>
              <b>{Math.round(DEFAULT_WEIGHTS.proximity * 100)}%</b> proximity
            </span>
            <span>
              <b>{Math.round(DEFAULT_WEIGHTS.fair * 100)}%</b> fair rotation
            </span>
            <span>
              <b>{Math.round(DEFAULT_WEIGHTS.venue * 100)}%</b> venue history
            </span>
            <span className="muted">· weights editable in /settings (§6)</span>
          </div>
          {/* Radar self-applications (§3.3, §10.4): the "Applied" marker with
              its relative time. Picking one confirms them and sends N10;
              once the role is fully confirmed the rest get N10c. */}
          {section.applied.map((booking) => (
            <div className="prow" key={booking.bookingId}>
              <Person person={booking} sub={`${section.roleName} · self-applied via Radar`} />
              {booking.qualified ? (
                <Pill tone="cyan">Qualified — this client · {section.roleName}</Pill>
              ) : null}
              <span className="applied">{appliedMarker(booking)}</span>
              <div className="right">
                <ApplicationActions
                  eventId={eventId}
                  bookingId={booking.bookingId}
                  name={booking.name}
                />
              </div>
            </div>
          ))}
          <div className="prow muted">
            The ranked pool arrives with the auto-assign engine (§3.4), which is a separate change.
            Its scoring, waves and hard gates already live in <code>@thc/domain</code>.
          </div>
        </div>
      ) : null}

      {section.unavailable.length > 0 ? (
        <div className="sub">
          <div className="subh">
            Unavailable <span className="n">{section.unavailable.length}</span>
          </div>
          {section.unavailable.map((person) => (
            <div className={classes('prow', 'muted')} key={person.staffId + person.gate}>
              <Person person={person} sub={GATE_LABEL[person.gate] ?? person.gate} />
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function confirmedLine(booking: BoardBooking, roleName: string): string {
  const parts = [roleName];
  if (booking.confirmedAt) {
    parts.push(`confirmed ${formatTimeIn(new Date(booking.confirmedAt), UK_ZONE)}`);
  }
  // The day-before "I'm ready" is the one hard deadline (§3.5), so whether it
  // has been pressed is what the manager most needs to see here.
  parts.push(
    booking.dayBeforeConfirmedAt
      ? `I'm ready ✓ ${formatTimeIn(new Date(booking.dayBeforeConfirmedAt), UK_ZONE)}`
      : "I'm ready — not yet",
  );
  if (booking.source === 'self') parts.push('self-applied via Radar');
  return parts.join(' · ');
}

/** "Applied 2h ago" (§3.3), computed on each render — never a snapshot. */
function appliedMarker(booking: BoardBooking): string {
  return booking.appliedAt ? appliedAgo(new Date(booking.appliedAt)) : 'Applied';
}

function invitedLine(booking: BoardBooking): string {
  const at = formatTimeIn(new Date(booking.createdAt), UK_ZONE);
  return `invited ${at} UK · ${booking.source}`;
}
