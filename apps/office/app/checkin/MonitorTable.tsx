'use client';

import { Avatar, Pill } from '@thc/ui';
import { displayTimeRange, formatTimeIn } from '@thc/domain';
import { STATUS_LABEL, breaksCell, duePillTime, statusTone } from './status';
import type { MonitorRow } from './types';

/**
 * The top half of §9.5 — who is on site and who is not.
 *
 * Three display rules from §1.8 sit in here and are easy to get backwards:
 *
 *   WINDOW   a SCHEDULED time, so it shows UK first with the viewer's own
 *            zone on a second line when those differ. It is the ROLE
 *            SECTION's window (RULE-18), so two rows on one event correctly
 *            show different hours.
 *   Check-in an ACTUAL stamp, so it shows the viewer's zone only — the
 *            manager wants to know what their own clock said.
 *   Due      the viewer's LOCAL clock with no suffix — deliberately, so it
 *            reads against the check-in stamp beside it (`duePillTime`).
 *
 * `zone` comes from the screen's mount-guarded `useViewerZone`, so the
 * server and the browser paint the same UK-only markup first (§1.8: the
 * second line "is not rendered at all for a viewer already in UK time").
 */
export function MonitorTable({ rows, zone }: { rows: MonitorRow[]; zone: string }) {
  const local = (iso: string) => formatTimeIn(new Date(iso), zone);

  if (rows.length === 0) {
    return <p className="muted sm">No shifts on the board for today.</p>;
  }

  return (
    <table className="tbl monitor-tbl">
      <thead>
        <tr>
          <th>Staff</th>
          <th>Event</th>
          <th>Window</th>
          <th>Check-in</th>
          <th>Breaks</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const win = displayTimeRange(new Date(row.startsAt), new Date(row.endsAt), zone);
          return (
            <tr key={row.bookingId}>
              <td>
                <div className="person">
                  <Avatar name={row.staffName} src={row.photoUrl ?? undefined} />
                  <div>
                    <div className="n">{row.staffName}</div>
                    <div className="s">{row.roleName}</div>
                  </div>
                </div>
              </td>
              <td>
                <b>{row.eventTitle}</b>
              </td>
              <td>
                <span className="win2">
                  {win.primary}
                  {win.secondary ? <span className="l2">{win.secondary}</span> : null}
                </span>
              </td>
              <td className="stamp">
                {row.checkInAt ? local(row.checkInAt) : <span className="muted">—</span>}
              </td>
              <td className="mono sm">{breaksCell(row, local)}</td>
              <td>
                <Pill tone={statusTone(row)}>
                  {row.status === 'checked_out' && row.checkOutAt
                    ? `${STATUS_LABEL.checked_out} ${local(row.checkOutAt)}`
                    : row.status === 'due'
                      ? `${STATUS_LABEL.due} ${duePillTime(row.startsAt, zone)}`
                      : STATUS_LABEL[row.status]}
                </Pill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
