'use client';

import { Avatar, Pill } from '@thc/ui';
import { UK_ZONE, formatTimeIn, needsDualZone, viewerZone } from '@thc/domain';
import { STATUS_LABEL, breaksCell, statusTone } from './status';
import type { MonitorRow } from './types';

/**
 * The top half of §9.5 — who is on site and who is not.
 *
 * Two display rules from §1.8 sit in here and are easy to get backwards:
 *
 *   WINDOW   a SCHEDULED time, so it shows UK first with the viewer's own
 *            zone on a second line when those differ. It is the ROLE
 *            SECTION's window (RULE-18), so two rows on one event correctly
 *            show different hours.
 *   Check-in an ACTUAL stamp, so it shows the viewer's zone only — the
 *            manager wants to know what their own clock said.
 */
export function MonitorTable({ rows }: { rows: MonitorRow[] }) {
  const zone = viewerZone();
  const dual = needsDualZone(zone);
  const local = (iso: string) => formatTimeIn(new Date(iso), zone);
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE);

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
        {rows.map((row) => (
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
                {uk(row.startsAt)} – {uk(row.endsAt)} UK time
                {dual ? (
                  <span className="l2">
                    {local(row.startsAt)} – {local(row.endsAt)} your time
                  </span>
                ) : null}
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
                    ? `${STATUS_LABEL.due} ${uk(row.startsAt)}`
                    : STATUS_LABEL[row.status]}
              </Pill>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
