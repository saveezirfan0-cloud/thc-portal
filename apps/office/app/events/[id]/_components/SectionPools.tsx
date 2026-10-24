import { Pill, Skeleton, SkeletonScreen, SkeletonText } from '@thc/ui';
import { type ScoreWeights, type TimeFormat, appliedAgo } from '@thc/domain';
import { type BoardPeople, type BoardSection, loadSectionPools } from '../board-data';
import { ApplicationActions } from './ApplicationActions';
import { InviteAnyway } from './InviteAnyway';
import { Person, appliedMarker } from './Person';
import { PotentialPool } from './PotentialPool';
import { StaffRoles } from './StaffRoles';

export interface SectionPoolsProps {
  section: BoardSection;
  known: BoardPeople;
  weights: ScoreWeights;
  eventId: string;
  clientName: string;
  /** `showsCandidatePools`: the event is live and this section still has room. */
  showPools: boolean;
  /** The event is upcoming or under way: Unavailable is drawn. */
  live: boolean;
  /** RULE-16: nothing is offered on a section that is over. */
  canInvite: boolean;
  format?: TimeFormat;
}

/**
 * One role section's Potential pool and Unavailable list (§3.3, §3.4,
 * ADR-0043) — the slow part of the board, so it streams (ADR-0161): the
 * section's header, Confirmed and Invited paint at once, and this fills in
 * behind `SectionPoolsSkeleton` when `auto_assign_candidates` answers. Each
 * section has its own boundary, so one slow pool holds back nobody else.
 *
 * Nothing here decides whether the board exists: the page has already read
 * the event and answered a real 404 before any boundary streams (ADR-0109).
 */
export async function SectionPools({
  section,
  known,
  weights,
  eventId,
  clientName,
  showPools,
  live,
  canInvite,
  format,
}: SectionPoolsProps) {
  const { pool, poolProblem, unavailable, calendarProblem } = await loadSectionPools(
    section.poolInput,
    known,
    weights,
    format,
  );

  return (
    <>
      {showPools && pool ? (
        <PotentialPool
          eventId={eventId}
          shiftId={section.id}
          clientName={clientName}
          roleName={section.roleName}
          entries={pool}
          weights={weights}
          problem={null}
          canInvite={canInvite}
          escalation={section.escalation}
        />
      ) : null}

      {showPools && !pool ? (
        // The candidates could not be computed: say so, and still offer the
        // Radar applicants, who are known from their bookings alone.
        <div className="sub">
          <div className="subh">Potential pool</div>
          <div className="prow coral sm" role="alert">
            {poolProblem ?? 'The candidate pool could not be computed.'}
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

      {live && (unavailable.length > 0 || calendarProblem) ? (
        // Collapsed by default (wireframe "Unavailable ▸ collapsed") — but
        // open when the calendar could not be read, so that is not hidden.
        <details className="sub" open={calendarProblem ? true : undefined}>
          <summary className="subh">
            <span className="car" aria-hidden="true" />
            Unavailable <span className="n">{unavailable.length}</span>
            <span className="right muted sm">wrong-role never produces a row here</span>
          </summary>
          {calendarProblem ? (
            // ADR-0043: without the calendar the pool above may list workers
            // the engine will skip. Say so rather than show a quiet list.
            <div className="prow coral sm" role="alert">
              {calendarProblem}
            </div>
          ) : null}
          {unavailable.map((person) => (
            <div className="prow" key={person.staffId}>
              <Person
                person={person}
                sub={
                  <StaffRoles name={person.name} roles={person.roles} roleName={section.roleName} />
                }
              />
              {person.appliedAt ? (
                <span className="applied">{appliedAgo(new Date(person.appliedAt))}</span>
              ) : null}
              <div className="right">
                <Pill tone={person.tone}>{person.label}</Pill>
                {person.detail ? <span className="muted xs">{person.detail}</span> : null}
                {/* ADR-0043, ADR-0208: the calendar and the escalation radius
                    hold back the machine, not the office — behind a confirm,
                    the ordinary manual invite. */}
                {person.inviteAnyway && canInvite && showPools ? (
                  <InviteAnyway
                    eventId={eventId}
                    shiftId={section.id}
                    staffId={person.staffId}
                    name={person.name}
                    reason={person.reason}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </details>
      ) : null}
    </>
  );
}

/**
 * The pool's place while it is ranked: its heading and three rows of
 * placeholders in the section's own row shape, announced once as busy. A
 * section whose pool is not drawn (full, or the event over) shows nothing —
 * its Unavailable list starts collapsed, so there is no place to hold.
 */
export function SectionPoolsSkeleton({
  showPools,
  roleName,
}: {
  showPools: boolean;
  roleName: string;
}) {
  if (!showPools) return null;
  return (
    <div className="sub">
      <div className="subh">Potential pool</div>
      <SkeletonScreen label={`Ranking the ${roleName} candidate pool`}>
        {Array.from({ length: 3 }, (_, index) => (
          <div className="skel-row" key={index}>
            <Skeleton shape="avatar" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </SkeletonScreen>
    </div>
  );
}
