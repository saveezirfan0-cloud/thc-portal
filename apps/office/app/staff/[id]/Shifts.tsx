'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Chip, Panel, Pill, ScheduledWindow, Select, TableScroll } from '@thc/ui';
import { ResolveModal } from '../../checkin/ResolveModal';
import { violationRowProps } from '../../checkin/violationRow';
import type { ViolationRow as DetailViolationRow } from '../../checkin/types';
import { formatUkDate } from '../staff';
import { useViewerZone } from '../../dashboard/_components/useViewerZone';
import {
  VIOLATION_LABEL,
  formatLocalStamp,
  formatLocalTime,
  payableHours,
  shiftOutcome,
  shiftsInRange,
} from './profile';
import type { ShiftRange } from './profile';
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
  now,
}: {
  shifts: ShiftRow[];
  violations: ViolationRow[];
  /** The same entries in the monitor's shape; absent when that read failed. */
  details?: DetailViolationRow[];
  /** The clock the 90-day range is measured from; the render's own by default. */
  now?: Date;
}) {
  const router = useRouter();
  // The Detected stamp is the monitor's: viewer-local (§1.8), because §9.6
  // says this log and /checkin's are the same log for the same reader.
  const zone = useViewerZone();
  const [showResolved, setShowResolved] = useState(true);
  // Wireframe: "Last 90 days / All", 90 days by default.
  const [range, setRange] = useState<ShiftRange>('90');
  const listed = useMemo(
    () => shiftsInRange(shifts, range, now ?? new Date()),
    [shifts, range, now],
  );
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
          <>
            <span className="muted sm">
              scheduled vs actual · actual stamps in your own zone · payable = intersection
            </span>
            <Select
              value={range}
              onChange={(event) => setRange(event.target.value as ShiftRange)}
              aria-label="Shift history range"
              style={{ height: 28, width: 150, fontSize: 12 }}
            >
              <option value="90">Last 90 days</option>
              <option value="all">All</option>
            </Select>
          </>
        }
        flush
      >
        {listed.length === 0 ? (
          <div className="empty">
            {shifts.length === 0 ? 'No shifts yet.' : 'No shifts in the last 90 days.'}
          </div>
        ) : (
          <TableScroll>
            {/* `card-rows`: below 760px each shift is a card titled by its
                event, every other cell naming its column. */}
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Client · Venue</th>
                  <th>Role</th>
                  <th>Scheduled</th>
                  <th>Check in / out</th>
                  <th>Payable</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((row) => (
                  <tr key={row.booking_id}>
                    <td data-label="Date" className="mono sm">
                      {formatUkDate(row.event_date)}
                    </td>
                    <td className="cell-title">{row.event_title}</td>
                    <td data-label="Client · Venue" className="sm">
                      {row.client_name}
                      <span className="sub">{row.venue_name}</span>
                    </td>
                    <td data-label="Role">
                      <Chip>{row.role_name}</Chip>
                    </td>
                    <td data-label="Scheduled" className="mono sm">
                      {/* §1.8: a scheduled window is UK time, plus "your
                          time" when the reader is elsewhere. */}
                      <ScheduledWindow
                        startsAt={row.starts_at}
                        endsAt={row.ends_at}
                        separator="–"
                      />
                    </td>
                    <td data-label="Check in / out" className="mono sm">
                      {row.check_in_at || row.check_out_at ? (
                        <>
                          {formatLocalTime(row.check_in_at)} · {formatLocalTime(row.check_out_at)}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label="Payable" className="mono sm">
                      {payableHours(row)}
                    </td>
                    <td data-label="Status">
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
              the same entries and the same detail window as /checkin — scoped to one person
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
            <table className="tbl card-rows">
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
                      <td className="cell-title">
                        {row.event_title} — {row.client_name}
                        <span className="sub">
                          {row.role_name} ·{' '}
                          <ScheduledWindow
                            startsAt={row.starts_at}
                            endsAt={row.ends_at}
                            separator="–"
                          />
                        </span>
                      </td>
                      <td data-label="Violation">
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
                      <td data-label="Time (your time)" className="mono sm">
                        {formatLocalStamp(row.detected_at, zone)}
                      </td>
                      <td data-label="Status">
                        <Pill tone={row.resolved ? 'green' : 'coral'}>
                          {row.resolved ? 'Resolved' : 'Unresolved'}
                        </Pill>
                      </td>
                      <td className="right-align cell-actions">
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
