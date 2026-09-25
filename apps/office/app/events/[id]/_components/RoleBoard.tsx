import Link from 'next/link';
import { Avatar, Chip, Panel, Pill } from '@thc/ui';
import {
  DEFAULT_WEIGHTS,
  type EventStatus,
  UK_ZONE,
  appliedAgo,
  canCancelBooking,
  canMarkNoShow,
  finalHourlyPence,
  formatAllocationPair,
  formatHours,
  formatTimeIn,
  marginPerHourPence,
  openSlots,
  roleBoardHeader,
  sectionHours,
  showsCandidatePools,
} from '@thc/domain';
import type { BoardBooking, BoardSection, BoardUnavailable } from '../board-data';
import { canToggleAutoAssign, payableLine, rowPill } from '../board-rules';
import { ActualStamp, ScheduledWindow } from '../../_components/ScheduledWindow';
import { ApplicationActions } from './ApplicationActions';
import { AutoAssignSwitch } from './AutoAssignSwitch';
import { BookingActions } from './BookingActions';

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** §3.3's own wording, as a pill plus the reason beside it (event-board.html:196-201). */
const GATE_LABEL: Record<string, { label: string; tone: 'coral' | 'amber'; note: string }> = {
  blocked: { label: 'Blocked — compliance', tone: 'coral', note: '' },
  booked_elsewhere: {
    label: 'Booked elsewhere',
    tone: 'amber',
    note: 'accepted an overlapping shift — the other booking stands (§3.4)',
  },
  hours_limit: { label: 'Hours limit reached', tone: 'amber', note: '(RULE-20)' },
  rtw_expired: { label: 'Right to work expired', tone: 'coral', note: '' },
  self_cancelled: {
    label: 'Rejected — self-cancelled',
    tone: 'coral',
    note: 'cancelled a confirmed booking more than 72 h before the shift · permanently excluded from this event: no auto-assign, no Radar, no manual invite (RULE-04)',
  },
  do_not_return: { label: 'Do not return', tone: 'coral', note: 'at this client' },
};

const gbp = (pounds: number) => `£${pounds.toFixed(2)}`;
const signed = (pence: number) =>
  `${pence < 0 ? '−' : '+'}£${(Math.abs(pence) / 100).toFixed(2)}/h`;

function Person({
  person,
  sub,
}: {
  person: BoardBooking | BoardUnavailable;
  sub: React.ReactNode;
}) {
  return (
    <>
      <Avatar name={person.name} deleted={person.deleted} />
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
  eventTitle,
  eventDateLabel,
  clientName,
  escalationRadiusMiles,
  now = new Date(),
}: {
  section: BoardSection;
  status: EventStatus;
  eventId: string;
  eventTitle: string;
  /** "Fri 19 Sep 2026" — for the dialogs' shift line. */
  eventDateLabel: string;
  /** "Qualified — Leonardo · Chef" (§3.3), never "this client". */
  clientName: string;
  escalationRadiusMiles: number;
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
  const live = status === 'upcoming' || status === 'ongoing';
  const windowEnded = status === 'ongoing' && now > endsAt;
  // §3.4: once the event is under way and a slot is open, the same-day
  // escalation (every 10 min, N-mile pool) has taken over from the hourly round.
  const escalating =
    status === 'ongoing' && now >= startsAt && openSlots(counts) > 0 && section.autoAssign;
  const noShowOpen = canMarkNoShow({ startsAt, endsAt }, now);
  const shiftLine = `${eventTitle} · ${section.roleName} · ${eventDateLabel} · ${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)} UK time`;

  const payPence = Math.round(section.payRate * 100);
  const chargePence = Math.round(section.chargeRate * 100);
  const margin = marginPerHourPence(chargePence, payPence);

  const worked = section.confirmed.filter((b) => !b.noShow && b.checkInAt).length;
  const noShows = section.confirmed.filter((b) => b.noShow).length;

  return (
    <Panel
      flush
      title={
        <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <b>{section.roleName}</b>
          <span className="mono sm">
            {status === 'completed'
              ? `${worked} worked${noShows > 0 ? ` · ${noShows} no-show` : ''} of ${formatAllocationPair(section.headcount, section.buffer)}`
              : roleBoardHeader(counts)}
          </span>
          {/* The section's scheduled window, both zones for a reader outside
              the UK (§1.8; event-board.html:137). */}
          <ScheduledWindow
            startsAt={startsAt}
            endsAt={endsAt}
            labelled
            className="mono sm muted rsh-win"
          />
          <span className="mono sm muted">{formatHours(sectionHours({ startsAt, endsAt }))}</span>
          {section.dressCode ? (
            <span className="sm muted">
              Dress code: <b>{section.dressCode}</b>
            </span>
          ) : null}
          {/* Holiday is broken out, never blended (§9.8): pay · final · charge · margin. */}
          <span className="sm muted rsh-rate">
            Pay <b>{gbp(section.payRate)}</b> · final {gbp(finalHourlyPence(payPence) / 100)} ·
            charge <b>{gbp(section.chargeRate)}</b> ·{' '}
            <span className={margin >= 0 ? 'green' : 'coral'}>{signed(margin)}</span>
          </span>
        </span>
      }
      actions={
        <span className="row sm muted" style={{ gap: 10, flexWrap: 'wrap' }}>
          {/* Absolute buffer, never the total (§3.2). */}
          <Pill>{formatAllocationPair(section.headcount, section.buffer)}</Pill>
          {live ? (
            <span className="muted xs">
              target {section.headcount + section.buffer} · allocation {section.allocationPerHour}/h
            </span>
          ) : null}
          {windowEnded ? <Pill>window ended</Pill> : null}
          {escalating ? (
            <Pill tone="purple">Escalation · every 10 min · {escalationRadiusMiles}-mile pool</Pill>
          ) : null}
          {canToggleAutoAssign(status) ? (
            <AutoAssignSwitch
              eventId={eventId}
              sectionId={section.id}
              checked={section.autoAssign}
              label="Auto-assign"
            />
          ) : null}
        </span>
      }
    >
      <div className="sub">
        <div className="subh">
          Confirmed <span className="n">{section.confirmed.length - noShows}</span>
          {noShows > 0 ? <span className="muted">+ {noShows} no-show</span> : null}
          <span className="right muted sm">
            {status === 'upcoming'
              ? 'the worker confirms in the app — no Confirm button here, only Withdraw'
              : 'check-in / out stamps in your local zone (§1.8) · payable = intersection with the scheduled window (RULE-01)'}
          </span>
        </div>
        {section.confirmed.length === 0 ? (
          <div className="prow muted">Nobody has confirmed yet.</div>
        ) : (
          section.confirmed.map((booking) => (
            <ConfirmedRow
              key={booking.bookingId}
              booking={booking}
              section={section}
              status={status}
              eventId={eventId}
              clientName={clientName}
              shiftLine={shiftLine}
              noShowOpen={noShowOpen}
              now={now}
            />
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
              <div
                className={classes('prow', booking.deleted && 'deleted')}
                key={booking.bookingId}
              >
                <Person person={booking} sub={invitedLine(booking)} />
                {booking.qualified ? (
                  <Chip tone="cyan">
                    Qualified — {clientName} · {section.roleName}
                  </Chip>
                ) : null}
                {/* Already invited and also self-applied: the marker shows
                    here rather than duplicating them into the pool (§3.3). */}
                {booking.appliedAt ? (
                  <span className="applied">{appliedMarker(booking, now)}</span>
                ) : null}
                <div className="right">
                  <Pill tone="amber">Awaiting</Pill>
                  <BookingActions
                    eventId={eventId}
                    bookingId={booking.bookingId}
                    name={booking.name}
                    shiftLine={shiftLine}
                    status={booking.status}
                    noShow={false}
                    noShowOpen={false}
                    checkInAt={null}
                    checkOutAt={null}
                    confirmed={false}
                    payrollExported={booking.payrollExported}
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
            <div className={classes('prow', booking.deleted && 'deleted')} key={booking.bookingId}>
              <Person person={booking} sub={`${section.roleName} · self-applied via Radar`} />
              {booking.qualified ? (
                <Chip tone="cyan">
                  Qualified — {clientName} · {section.roleName}
                </Chip>
              ) : null}
              <span className="applied">{appliedMarker(booking, now)}</span>
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
            The ranked pool — rank, score with its factor breakdown, search, Applied / Not applied
            and Invite — needs an admin-callable read over the engine&rsquo;s candidate gate (
            <code>auto_assign_candidates</code> is service-role only today), which is a database
            change. Its scoring, waves and hard gates already live in <code>@thc/domain</code>.
          </div>
        </div>
      ) : null}

      {/* No Unavailable on a Completed or Cancelled event — hidden entirely,
          not shown empty (§3.3; event-board.html:295). */}
      {live && section.unavailable.length > 0 ? (
        <div className="sub">
          <div className="subh">
            Unavailable <span className="n">{section.unavailable.length}</span>
            <span className="right muted sm">wrong-role never produces a row here (§6)</span>
          </div>
          {section.unavailable.map((person) => {
            const gate = GATE_LABEL[person.gate];
            return (
              <div
                className={classes('prow', person.deleted && 'deleted')}
                key={person.staffId + person.gate}
              >
                <Person person={person} sub={section.roleName} />
                <div className="right">
                  <Pill tone={gate?.tone ?? 'amber'}>{gate?.label ?? person.gate}</Pill>
                  {gate?.note ? <span className="muted xs">{gate.note}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * One confirmed row (event-board.html:140, 252-266, 316-330): the sub-line
 * before arrival, then the stamps in the reader's zone, the payable line
 * (RULE-01) and the docs/07 pill, with No show / Get back / Withdraw.
 */
function ConfirmedRow({
  booking,
  section,
  status,
  eventId,
  clientName,
  shiftLine,
  noShowOpen,
  now,
}: {
  booking: BoardBooking;
  section: BoardSection;
  status: EventStatus;
  eventId: string;
  clientName: string;
  shiftLine: string;
  noShowOpen: boolean;
  now: Date;
}) {
  const pill = rowPill(booking);
  const payable = payableLine(booking);
  return (
    <div
      className={classes('prow', booking.noShow && 'noshow', booking.deleted && 'deleted')}
      data-booking={booking.bookingId}
    >
      <Person person={booking} sub={confirmedLine(booking, section.roleName, status)} />
      {booking.qualified && status === 'upcoming' ? (
        <Chip tone="cyan">
          Qualified — {clientName} · {section.roleName}
        </Chip>
      ) : null}
      {booking.appliedAt && !booking.checkInAt ? <span className="applied">Applied</span> : null}

      {booking.checkInAt ? (
        <span className="stamp">
          in{' '}
          <b>
            <ActualStamp at={booking.checkInAt} />
          </b>
          {booking.checkOutAt ? (
            <>
              {' '}
              · out{' '}
              <b>
                <ActualStamp at={booking.checkOutAt} />
              </b>
            </>
          ) : booking.noCheckout && !booking.noCheckout.resolved ? (
            <>
              {' '}
              · out <b>—</b>
            </>
          ) : null}
          {!booking.checkOutAt && booking.minutesLate ? ` · Late ${booking.minutesLate} min` : ''}
        </span>
      ) : null}
      {payable && status === 'completed' ? <span className="stamp">{payable}</span> : null}

      {/* A no-show stays here, badged — never moved to its own list (§3.3). */}
      {booking.noShow ? (
        <>
          <Pill tone="coral">No show</Pill>
          <span className="muted xs">
            {status === 'completed'
              ? 'paid nothing · show-rate penalty · Violation logged'
              : 'check-in locked · show-rate penalty applied'}
          </span>
        </>
      ) : null}
      {booking.reconfirmRequired ? <Pill tone="amber">Awaiting re-confirm</Pill> : null}

      <div className="right">
        {pill?.kind === 'on_shift' ? <Pill tone="green">On shift</Pill> : null}
        {pill?.kind === 'checked_out' && booking.checkOutAt ? (
          <Pill>
            Checked out <ActualStamp at={booking.checkOutAt} />
          </Pill>
        ) : null}
        {pill?.kind === 'no_checkout' ? (
          <>
            <Pill tone="coral">No check-out</Pill>
            <Link className="btn sm outline" href="/checkin">
              Resolve in Violation log
            </Link>
          </>
        ) : null}
        {booking.checkOutAt && booking.minutesLate ? <Pill tone="amber">Late</Pill> : null}
        {booking.leftEarly ? <Pill tone="coral">Left early</Pill> : null}
        <BookingActions
          eventId={eventId}
          bookingId={booking.bookingId}
          name={booking.name}
          shiftLine={shiftLine}
          status={booking.status}
          noShow={booking.noShow}
          noShowOpen={noShowOpen && now >= new Date(section.startsAt)}
          checkInAt={booking.checkInAt}
          checkOutAt={booking.checkOutAt}
          confirmed
          payrollExported={booking.payrollExported}
          // Checked in = `worked`, which §3.6 never cancels; a removed
          // worker is not withdrawn either — their row is history (§1.7).
          withdrawable={canCancelBooking(booking.status) && !booking.deleted}
        />
      </div>
    </div>
  );
}

const UK_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: UK_ZONE,
});

function confirmedLine(booking: BoardBooking, roleName: string, status: EventStatus): string {
  const parts = [roleName];
  // Once the shift has started the stamps say what matters; before it, the
  // confirmation date and the day-before "I'm ready" — the one hard
  // deadline (§3.5) — are what the manager most needs to see.
  if (status === 'upcoming') {
    if (booking.confirmedAt)
      parts.push(`confirmed ${UK_DAY.format(new Date(booking.confirmedAt))}`);
    parts.push(
      booking.dayBeforeConfirmedAt
        ? `I'm ready ✓ ${formatTimeIn(new Date(booking.dayBeforeConfirmedAt), UK_ZONE)}`
        : "I'm ready — not yet",
    );
  }
  if (booking.source === 'self') parts.push('self-applied via Radar');
  if (booking.deleted) parts.push('GDPR-removed — row stays so the headcount is not skewed (§1.7)');
  return parts.join(' · ');
}

/** "Applied 2h ago" (§3.3), computed on each render — never a snapshot. */
function appliedMarker(booking: BoardBooking, now: Date): string {
  return booking.appliedAt ? appliedAgo(new Date(booking.appliedAt), now) : 'Applied';
}

/** "invited 13:17 UK · auto" — the round and the inviter are not stored on the booking yet. */
function invitedLine(booking: BoardBooking): string {
  const at = formatTimeIn(new Date(booking.createdAt), UK_ZONE);
  return `invited ${at} UK · ${booking.source}`;
}
