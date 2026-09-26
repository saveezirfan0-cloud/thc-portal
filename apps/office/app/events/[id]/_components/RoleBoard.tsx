import { Avatar, Pill } from '@thc/ui';
import {
  type EventStatus,
  type ScoreWeights,
  UK_ZONE,
  appliedAgo,
  canCancelBooking,
  canMarkNoShow,
  formatAllocationPair,
  formatHours,
  formatTimeIn,
  openSlots,
  roleBoardHeader,
  sectionHours,
  showsCandidatePools,
} from '@thc/domain';
import type { BoardBooking, BoardSection } from '../board-data';
import {
  type UnavailableEntry,
  canToggleAutoAssign,
  handedOverLine,
  offerChip,
  rateLine,
  roleBlockOpen,
} from '../board-model';
import { ScheduledWindow } from '../../_components/ScheduledWindow';
import { ApplicationActions } from './ApplicationActions';
import { AttendancePills, AttendanceStamp } from './Attendance';
import { AutoAssignSwitch } from './AutoAssignSwitch';
import { BookingActions } from './BookingActions';
import { InviteAnyway } from './InviteAnyway';
import { PotentialPool } from './PotentialPool';
import { RoleBlock } from './RoleBlock';

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
 * auto-assign switch (§3.4). Clicking the heading collapses the block; a
 * block whose window is over starts collapsed; Unavailable starts collapsed
 * (wireframe).
 *
 * Confirmed rows carry the day's attendance from `check_logs` and
 * `violations` — On shift / Checked out HH:MM / Late / Left early / No
 * check-out with the way to the Violation log — and "No show" only once
 * the section has started (`canMarkNoShow`).
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
  const windowEnded = now > endsAt;
  const noShowAllowed = canMarkNoShow({ startsAt, endsAt }, now);
  // §3.4: the 10-minute escalation owns a started section that is short.
  const escalating =
    live && section.escalation && openSlots(counts) > 0 && section.autoAssign && eventAutoAssign;
  // "Ongoing but has re-opened slots": Invited and the pool came back.
  const reopened = status === 'ongoing' && openSlots(counts) > 0;

  return (
    <RoleBlock
      defaultOpen={roleBlockOpen(section, status, now)}
      heading={
        <>
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
        </>
      }
      actions={
        <span className="row sm muted" style={{ gap: 10 }}>
          {windowEnded ? <Pill>window ended</Pill> : null}
          {/* Absolute buffer, never the total (§3.2). */}
          <Pill>{formatAllocationPair(section.headcount, section.buffer)}</Pill>
          {escalating ? (
            <Pill tone="purple">Escalation · every 10 min · radius pool</Pill>
          ) : (
            <span className="xs">
              target {section.headcount + section.buffer} · allocation {section.allocationPerHour}
              /h
            </span>
          )}
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
        {/* ADR-0046: who handed this section's shift to whom. The line-up
            changed only when the booking did, as for a Withdraw and re-fill. */}
        {section.handovers.map((handover) => (
          <div className="prow muted sm" key={`${handover.at}:${handover.toName}`}>
            {handedOverLine(handover)}
          </div>
        ))}
        {section.confirmed.length === 0 ? (
          <div className="prow muted">Nobody has confirmed yet.</div>
        ) : (
          section.confirmed.map((booking) => (
            <div className={booking.noShow ? 'prow noshow' : 'prow'} key={booking.bookingId}>
              <Person person={booking} sub={confirmedLine(booking, section.roleName)} />
              <AttendanceStamp attendance={booking.attendance} />
              {booking.qualified ? (
                <Pill tone="cyan">
                  Qualified — {clientName} · {section.roleName}
                </Pill>
              ) : null}
              {booking.appliedAt ? <span className="applied">Applied</span> : null}
              {/* A no-show stays here, badged — never moved to its own list (§3.3). */}
              {booking.noShow ? <Pill tone="coral">No show</Pill> : null}
              {booking.reconfirmRequired ? <Pill tone="amber">Awaiting re-confirm</Pill> : null}
              {/* ADR-0046: still confirmed, still counted — only a chip. */}
              {booking.offer ? (
                <Pill tone={offerChip(booking.offer).tone}>{offerChip(booking.offer).label}</Pill>
              ) : null}
              <div className="right">
                <AttendancePills attendance={booking.attendance} />
                <BookingActions
                  eventId={eventId}
                  bookingId={booking.bookingId}
                  noShow={booking.noShow}
                  confirmed
                  payrollExported={payrollExported}
                  // Checked in = `worked`, which §3.6 never cancels.
                  withdrawable={canCancelBooking(booking.status)}
                  // A checked-in worker (`worked`, e.g. just got back) is not a
                  // no-show: office_mark_no_show() refuses already_checked_in,
                  // so the button is not offered.
                  noShowAllowed={noShowAllowed && booking.status !== 'worked'}
                  offer={live ? booking.offer : null}
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
              {reopened ? <Pill tone="purple">re-opened</Pill> : null}
              {section.escalation
                ? 'escalation invites, proximity first'
                : 'invitations have no deadline and are never withdrawn by auto-assign'}
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
          escalation={section.escalation}
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

      {live && (section.unavailable.length > 0 || section.calendarProblem) ? (
        // Collapsed by default (wireframe "Unavailable ▸ collapsed") — but
        // open when the calendar could not be read, so that is not hidden.
        <details className="sub" open={section.calendarProblem ? true : undefined}>
          <summary className="subh">
            <span className="car" aria-hidden="true" />
            Unavailable <span className="n">{section.unavailable.length}</span>
            <span className="right muted sm">wrong-role never produces a row here</span>
          </summary>
          {section.calendarProblem ? (
            // ADR-0043: without the calendar the pool above may list workers
            // the engine will skip. Say so rather than show a quiet list.
            <div className="prow coral sm" role="alert">
              {section.calendarProblem}
            </div>
          ) : null}
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
                {/* ADR-0043: the calendar holds back the machine, not the
                    office — behind a confirm, the ordinary manual invite. */}
                {person.inviteAnyway && canInvite && showPools ? (
                  <InviteAnyway
                    eventId={eventId}
                    shiftId={section.id}
                    staffId={person.staffId}
                    name={person.name}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </details>
      ) : null}
    </RoleBlock>
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
  // ADR-0046: booked by taking a shift another worker offered up.
  if (booking.source === 'offer') parts.push('took an offered shift');
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
