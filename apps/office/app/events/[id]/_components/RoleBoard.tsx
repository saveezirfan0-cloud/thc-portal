import { Avatar, Panel, Pill } from '@thc/ui';
import {
  type EventStatus,
  type ScoreWeights,
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
import type { BoardBooking, BoardSection } from '../board-data';
import { type UnavailableEntry, canToggleAutoAssign, rateLine } from '../board-model';
import { ScheduledWindow } from '../../_components/ScheduledWindow';
import { ApplicationActions } from './ApplicationActions';
import { AutoAssignSwitch } from './AutoAssignSwitch';
import { BookingActions } from './BookingActions';
import { PotentialPool } from './PotentialPool';

function Person({ person, sub }: { person: BoardBooking | UnavailableEntry; sub: string }) {
  return (
    <>
      <Avatar name={person.name} deleted={person.name.startsWith('Deleted account')} />
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
 * invitation fills nothing. The header also carries the role's own window
 * (UK, plus "your time" outside the UK — §1.8), its dress code, pay with
 * the holiday-inclusive final rate and the margin (§9.8), and the role's
 * auto-assign switch (§3.4).
 */
export function RoleBoard({
  section,
  status,
  eventId,
  clientName,
  eventAutoAssign,
  weights,
  payrollExported,
  now = new Date(),
}: {
  section: BoardSection;
  status: EventStatus;
  eventId: string;
  clientName: string;
  eventAutoAssign: boolean;
  weights: ScoreWeights;
  payrollExported: boolean;
  now?: Date;
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
  // §3.3 wireframe: no Unavailable on a Completed or Cancelled event either.
  const live = status === 'upcoming' || status === 'ongoing';
  const rate = rateLine(section.payRate, section.chargeRate);
  // RULE-16: nothing is offered on a section that is over.
  const canInvite = live && now < endsAt;

  return (
    <Panel
      flush
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <b>{section.roleName}</b>
          <span className="mono sm">{roleBoardHeader(counts)}</span>
          <ScheduledWindow
            className="win mono sm"
            lineClass="l2"
            startsAt={section.startsAt}
            endsAt={section.endsAt}
            suffix={`UK time · ${formatHours(sectionHours({ startsAt, endsAt }))}`}
          />
          {section.dressCode ? (
            <span className="sm muted">
              Dress code: <b>{section.dressCode}</b>
            </span>
          ) : null}
          {/* Base, then base + 12.07% holiday broken out (§9.8), then the margin. */}
          <span className="rate sm muted">
            Pay <b>{rate.pay}</b> · final {rate.final} · charge <b>{rate.charge}</b> ·{' '}
            <span className={rate.marginTone}>{rate.margin}</span>
          </span>
        </span>
      }
      actions={
        <span className="row sm muted" style={{ gap: 10 }}>
          {/* Absolute buffer, never the total (§3.2). */}
          <Pill>{formatAllocationPair(section.headcount, section.buffer)}</Pill>
          <span className="xs">
            target {section.headcount + section.buffer} · allocation {section.allocationPerHour}/h
          </span>
          <AutoAssignSwitch
            eventId={eventId}
            shiftId={section.id}
            checked={section.autoAssign}
            disabled={!canToggleAutoAssign(status)}
            label={eventAutoAssign ? 'Auto-assign' : 'Auto-assign (event switch off)'}
          />
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
                <Pill tone="cyan">
                  Qualified — {clientName} · {section.roleName}
                </Pill>
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
                  <Pill tone="cyan">
                    Qualified — {clientName} · {section.roleName}
                  </Pill>
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

      {showPools && section.pool ? (
        <PotentialPool
          eventId={eventId}
          shiftId={section.id}
          clientName={clientName}
          roleName={section.roleName}
          entries={section.pool}
          weights={weights}
          problem={null}
          canInvite={canInvite}
        />
      ) : null}

      {showPools && !section.pool ? (
        // The candidates could not be computed: say so, and still offer the
        // Radar applicants, who are known from their bookings alone.
        <div className="sub">
          <div className="subh">Potential pool</div>
          <div className="prow coral sm" role="alert">
            {section.poolProblem ?? 'The candidate pool could not be computed.'}
          </div>
          {section.applied.map((booking) => (
            <div className="prow" key={booking.bookingId}>
              <Person person={booking} sub={`${section.roleName} · self-applied via Radar`} />
              <span className="applied">{appliedMarker(booking)}</span>
              <div className="right">
                {canInvite ? (
                  <ApplicationActions
                    eventId={eventId}
                    bookingId={booking.bookingId}
                    name={booking.name}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {live && section.unavailable.length > 0 ? (
        <div className="sub">
          <div className="subh">
            Unavailable <span className="n">{section.unavailable.length}</span>
            <span className="right muted sm">wrong-role never produces a row here (§6)</span>
          </div>
          {section.unavailable.map((person) => (
            <div className="prow" key={person.staffId}>
              <Person
                person={person}
                sub={person.roles.length > 0 ? person.roles.join(' · ') : section.roleName}
              />
              {person.appliedAt ? (
                <span className="applied">{appliedAgo(new Date(person.appliedAt))}</span>
              ) : null}
              <div className="right">
                <Pill tone={person.tone}>{person.label}</Pill>
                {person.detail ? <span className="muted xs">{person.detail}</span> : null}
              </div>
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
