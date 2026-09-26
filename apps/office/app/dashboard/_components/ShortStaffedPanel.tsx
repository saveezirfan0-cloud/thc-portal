import Link from 'next/link';
import { Alert, EmptyState, Panel, Pill, TableScroll } from '@thc/ui';
import {
  type ShortStaffedRole,
  confirmedOf,
  openLabel,
  shortStaffedSummary,
} from '../short-staffed';
import { fillChip } from '../view-model';
import { ScheduledStart } from './ScheduledStart';

/**
 * "Short-staffed — next 48 hours".
 *
 * Every ROLE SECTION starting in the next 48 hours with fewer confirmed
 * workers than its headcount, soonest first, each with a way straight to
 * its event board. One line per role, not per event: two roles on one
 * event run their own windows and fill separately (RULE-18), and "the
 * gala is short" does not say whom to call.
 *
 * Fill is confirmed of HEADCOUNT. The buffer is not a shortfall — a role
 * with its headcount met and its buffer empty is staffed — and an invited
 * worker is not a confirmed one. No money on this panel.
 */
export function ShortStaffedPanel({
  roles,
  problem,
}: {
  /** null: nothing could be read (no database, or the read failed). */
  roles: ShortStaffedRole[] | null;
  problem: string | null;
}) {
  return (
    <Panel
      className="dash-short"
      title={
        <>
          Short-staffed <span className="muted sm">· next 48 hours</span>{' '}
          {roles ? (
            <Pill tone={roles.length === 0 ? 'green' : 'amber'}>{shortStaffedSummary(roles)}</Pill>
          ) : null}
        </>
      }
      flush
    >
      <div className="panel-b tight">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {roles === null ? (
          problem ? null : (
            <p className="muted sm">No figures.</p>
          )
        ) : roles.length === 0 ? (
          <EmptyState>
            Every role starting in the next 48 hours has its headcount confirmed.
          </EmptyState>
        ) : (
          <TableScroll>
            <table className="tbl card-rows dash-short-tbl">
              <thead>
                <tr>
                  {/* A scheduled time, so the column names its zone. */}
                  <th>Starts (UK time)</th>
                  <th>Event</th>
                  <th>Role</th>
                  <th>Confirmed</th>
                  <th>Open</th>
                  <th aria-label="Event board" />
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => {
                  const chip = fillChip(role.confirmed, role.headcount);
                  return (
                    <tr key={role.shiftId}>
                      <td data-label="Starts (UK time)">
                        <ScheduledStart startsAt={role.startsAt} />
                      </td>
                      <td className="cell-title">
                        <b>{role.eventTitle}</b>
                        <span className="sub">
                          {role.clientName} · {role.venueName}
                        </span>
                      </td>
                      <td data-label="Role">
                        <span className="chip">{role.roleName}</span>
                      </td>
                      <td data-label="Confirmed">
                        <Pill tone={chip.tone}>{confirmedOf(role)}</Pill>
                      </td>
                      <td data-label="Open" className="mono">
                        {openLabel(role.open)}
                      </td>
                      <td>
                        <Link className="btn sm" href={`/events/${role.eventId}`}>
                          Open board →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
    </Panel>
  );
}
