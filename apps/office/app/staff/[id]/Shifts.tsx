'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Chip, Panel, Pill, TableScroll } from '@thc/ui';
import { ResolveModal } from '../../checkin/ResolveModal';
import { violationRowProps } from '../../checkin/violationRow';
import type { ViolationRow as DetailViolationRow } from '../../checkin/types';
import { formatUkDate } from '../staff';
import { useViewerZone } from '../../dashboard/_components/useViewerZone';
import {
  VIOLATION_LABEL,
  formatLocalStamp,
  formatLocalTime,
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
 * The violation log opens the /checkin detail window and its Resolve.
 * §9.6 says the profile's log and the §9.5 monitor's are "deliberately
 * identical in behaviour", so this is not a second implementation: it is
 * the monitor's own `ResolveModal`, fed by the monitor's own query
 * (`loadStaffViolationLog`), with the same row behaviour — coral bar on an
 * unresolved entry, the whole row opens it, from the keyboard too.
 */
export function Shifts({
  shifts,
  violations,
  details,
}: {
  shifts: ShiftRow[];
  violations: ViolationRow[];
  /** The same entries in the monitor's shape; absent when that read failed. */
  details?: DetailViolationRow[];
}) {
  const router = useRouter();
  // The Detected stamp is the monitor's: viewer-local (§1.8), because §9.6
  // says this log and /checkin's are the same log for the same reader.
  const zone = useViewerZone();
  const [showResolved, setShowResolved] = useState(true);
  const [open, setOpen] = useState<DetailViolationRow | null>(null);
  const shown = violations.filter((row) => showResolved || !row.resolved);
  const byId = useMemo(() => new Map((details ?? []).map((row) => [row.id, row])), [details]);

  const close = () => {
    setOpen(null);
    // A resolution changes this tab (status, note) and the KPI row above.
    router.refresh();
  };

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
                  <th>Time (your time)</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const detail = byId.get(row.id);
                  const openRow = detail ? () => setOpen(detail) : null;
                  return (
                    <tr
                      key={row.id}
                      {...(openRow
                        ? violationRowProps(row, openRow, 0.6)
                        : {
                            className: row.resolved ? undefined : 'violation',
                            style: row.resolved ? { opacity: 0.6 } : undefined,
                          })}
                    >
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
                      <td className="mono sm">{formatLocalStamp(row.detected_at, zone)}</td>
                      <td>
                        <Pill tone={row.resolved ? 'green' : 'coral'}>
                          {row.resolved ? 'Resolved' : 'Unresolved'}
                        </Pill>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {openRow ? (
                          <Button
                            size="sm"
                            tone={row.resolved ? 'ghost' : 'default'}
                            onClick={(event) => {
                              // The row opens the same window; one open, not two.
                              event.stopPropagation();
                              openRow();
                            }}
                          >
                            {row.resolved ? 'Details' : 'Details / Resolve'}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      {open ? <ResolveModal violation={open} onClose={close} /> : null}
    </div>
  );
}
