'use client';

import { useState } from 'react';
import { Checkbox, Chip, Panel, Pill, TableScroll } from '@thc/ui';
import { formatUkDate } from '../staff';
import {
  VIOLATION_LABEL,
  formatLocalTime,
  formatUkStamp,
  formatUkWindow,
  payableHours,
  shiftOutcome,
} from './profile';
import type { ShiftRow, ViolationRow } from './types';

/**
 * The Shifts tab (§9.6): this worker's own shift history together with
 * their violation log.
 *
 * §1.8 decides which clock each column uses, and the two are different on
 * purpose. The scheduled window is the role section's, in UK time and
 * labelled as such — RULE-18, never the event window. The check-in and
 * check-out stamps are the viewer's own local time, because a worker who
 * pressed the button at 17:03 did so at 17:03 where they were standing.
 *
 * Resolve is not offered here. §9.6 says the profile's log and the §9.5
 * monitor's are "deliberately identical in behaviour" — a resolution
 * carries a mandatory note and belongs to the check-in domain, so the row
 * links there rather than growing a second implementation that could
 * diverge from it.
 */
export function Shifts({ shifts, violations }: { shifts: ShiftRow[]; violations: ViolationRow[] }) {
  const [showResolved, setShowResolved] = useState(true);
  const shown = violations.filter((row) => showResolved || !row.resolved);

  return (
    <div className="stack">
      <Panel
        title="Shift history"
        actions={
          <span className="muted sm">
            scheduled in UK time · actual stamps in your own zone (§1.8) · payable = intersection
            (RULE-01)
          </span>
        }
        flush
      >
        {shifts.length === 0 ? (
          <div className="empty">No shifts yet.</div>
        ) : (
          <TableScroll>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Client · Venue</th>
                  <th>Role</th>
                  <th>Scheduled (UK)</th>
                  <th>Check in / out</th>
                  <th>Payable</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((row) => (
                  <tr key={row.booking_id}>
                    <td className="mono sm">{formatUkDate(row.event_date)}</td>
                    <td>{row.event_title}</td>
                    <td className="sm">
                      {row.client_name}
                      <span className="sub">{row.venue_name}</span>
                    </td>
                    <td>
                      <Chip>{row.role_name}</Chip>
                    </td>
                    <td className="mono sm">{formatUkWindow(row.starts_at, row.ends_at)}</td>
                    <td className="mono sm">
                      {row.check_in_at || row.check_out_at ? (
                        <>
                          {formatLocalTime(row.check_in_at)} · {formatLocalTime(row.check_out_at)}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono sm">{payableHours(row)}</td>
                    <td>
                      <Pill tone={row.kind === 'no_show' ? 'coral' : undefined}>
                        {shiftOutcome(row)}
                      </Pill>
                      {row.unresolved_violation_count > 0 ? (
                        <Pill tone="coral">{row.unresolved_violation_count} unresolved</Pill>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      <Panel
        title="Violation log"
        actions={
          <>
            <span className="muted sm">
              the same entries and the same detail window as /checkin — scoped to one person (§9.6)
            </span>
            <Checkbox checked={showResolved} onChange={setShowResolved}>
              Show resolved
            </Checkbox>
          </>
        }
        flush
      >
        {shown.length === 0 ? (
          <div className="empty">
            {violations.length === 0 ? 'No violations.' : 'Nothing unresolved.'}
          </div>
        ) : (
          <TableScroll>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Violation</th>
                  <th>Detected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} style={row.resolved ? { opacity: 0.6 } : undefined}>
                    <td>
                      {row.event_title} — {row.client_name}
                      <span className="sub">
                        {row.role_name} · {formatUkWindow(row.starts_at, row.ends_at)} UK time
                      </span>
                    </td>
                    <td>
                      <b>{VIOLATION_LABEL[row.type]}</b>
                      {row.minutes_late !== null ? (
                        <span className="sub">{row.minutes_late} min</span>
                      ) : null}
                      {row.resolution_note ? (
                        <span className="sub">
                          {row.resolved_by_name ? `${row.resolved_by_name}: ` : ''}
                          &ldquo;{row.resolution_note}&rdquo;
                        </span>
                      ) : null}
                    </td>
                    <td className="mono sm">{formatUkStamp(row.detected_at)}</td>
                    <td>
                      <Pill tone={row.resolved ? 'green' : 'coral'}>
                        {row.resolved ? 'Resolved' : 'Unresolved'}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}
