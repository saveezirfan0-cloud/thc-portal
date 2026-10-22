'use client';

import { Avatar, Button, Pill, TableScroll, useTimeFormat } from '@thc/ui';
import { UK_ZONE, formatTimeIn, needsDualZone, overWeeklyLimitText } from '@thc/domain';
import {
  LATE_CHECK_OUT_LABEL,
  NUDGE_LABEL,
  arrivalLine,
  lateCheckOutToVerify,
  nudgeKind,
  statusLabel,
  breaksCell,
  statusTone,
} from './status';
import type { MonitorRow } from './types';
import { useNow } from './useNow';
import { useViewerZone } from './useViewerZone';

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
 *   Due      the pill carries the scheduled start in the VIEWER's zone with
 *            no suffix — deliberately, §1.8: "must not be 'fixed' back to UK
 *            time"; the Window column beside it carries both (audit D30).
 *
 * The zone is `useViewerZone()`, not `viewerZone()`: during the server
 * render of this client component `Intl` is the server's zone (UTC on
 * Vercel), which streamed UTC stamps and forced a hydration re-render
 * (audit D41). First paint is UK; the reader's zone arrives on mount.
 *
 * Remind (ADR-0187) sits under the pill of a worker who has not checked in
 * (from 30 minutes before the start) or has not checked out (from 30 minutes
 * before the end): one press queues the register's own N9 / N9b push. It is
 * a control, not a status, so it carries no colour of its own.
 *
 * A checked-out row signed out more than 15 minutes late keeps §9.5's red
 * pill, with "Signed out late — verify with the worker" and a Verify
 * button under it until the office has (ADR-0184); then the pill goes
 * back to neutral and the line says who verified it.
 */
export function MonitorTable({
  rows,
  onVerify,
  onNudge,
  nudging = null,
  nudgeErrors = {},
}: {
  rows: MonitorRow[];
  /** Opens the Verify window for a late sign-out (ADR-0184). */
  onVerify?: (row: MonitorRow) => void;
  /** Pushes the worker to check in or out (ADR-0187). */
  onNudge?: (row: MonitorRow) => void;
  /** The booking whose reminder is on its way. */
  nudging?: string | null;
  /** A refused reminder's reason, beside the row it was for. */
  nudgeErrors?: Record<string, string>;
}) {
  const now = useNow();
  const zone = useViewerZone();
  const format = useTimeFormat();
  const dual = needsDualZone(zone);
  const local = (iso: string) => formatTimeIn(new Date(iso), zone, format);
  const uk = (iso: string) => formatTimeIn(new Date(iso), UK_ZONE, format);

  if (rows.length === 0) {
    // The panel is `flush` (the table runs edge to edge), so the message
    // brings its own body padding — bare, the card's corner clipped it.
    return (
      <div className="panel-b">
        <p className="muted sm">No shifts on the board for today.</p>
      </div>
    );
  }

  return (
    <TableScroll label="Live check-in monitor" minWidth="44rem">
      <table className="tbl card-rows monitor-tbl">
        <thead>
          <tr>
            <th className="col-l">Staff</th>
            <th>Event</th>
            <th className="col-m">Window</th>
            <th>Check-in</th>
            <th>Breaks</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const nudge = onNudge && now ? nudgeKind(row, now) : null;
            return (
              <tr key={row.bookingId}>
                <td className="cell-title">
                  <div className="person">
                    <Avatar name={row.staffName} src={row.photoUrl ?? undefined} />
                    <div>
                      <div className="n">{row.staffName}</div>
                      <div className="s">{row.roleName}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Event">
                  <b>{row.eventTitle}</b>
                </td>
                <td data-label="Window">
                  <span className="win2">
                    {uk(row.startsAt)} – {uk(row.endsAt)} UK time
                    {dual ? (
                      <span className="l2">
                        {local(row.startsAt)} – {local(row.endsAt)} your time
                      </span>
                    ) : null}
                  </span>
                </td>
                <td data-label="Check-in" className="stamp">
                  {row.checkInAt ? local(row.checkInAt) : <span className="muted">—</span>}
                  {row.checkInAt && row.locationSuspect ? (
                    <Pill
                      tone="amber"
                      className="loc-flag"
                      title="The phone's location for this arrival was missing its accuracy, too vague for the geofence, or exactly on the venue's pin. The check-in stands; check with the worker if it matters."
                    >
                      Location unverified
                    </Pill>
                  ) : null}
                  {/* checkin.html's second line: on site, and how late. */}
                  {row.checkInAt ? <span className="sub">{arrivalLine(row)}</span> : null}
                </td>
                <td data-label="Breaks" className="mono sm">
                  {breaksCell(row, local)}
                </td>
                <td data-label="Status">
                  <Pill tone={statusTone(row)}>{statusLabel(row, local)}</Pill>
                  {lateCheckOutToVerify(row) ? (
                    <span className="sub late-out">
                      {LATE_CHECK_OUT_LABEL}
                      {onVerify ? (
                        <Button size="sm" onClick={() => onVerify(row)}>
                          Verify
                        </Button>
                      ) : null}
                    </span>
                  ) : row.status === 'checked_out' && row.lateCheckOut ? (
                    <span className="sub">
                      Signed out late · verified
                      {row.lateCheckOutVerifiedByName
                        ? ` by ${row.lateCheckOutVerifiedByName}`
                        : ''}
                    </span>
                  ) : null}
                  {row.status === 'checked_out' && row.lateCheckOut ? (
                    <WeeklyLimitFlag hours={row.weekHours} cap={row.weekCapHours} />
                  ) : null}
                  {/* ADR-0187: the register's N9 / N9b, on the manager's press. */}
                  {onNudge && nudge ? (
                    <span className="sub">
                      <Button
                        size="sm"
                        disabled={nudging === row.bookingId}
                        onClick={() => onNudge(row)}
                      >
                        {nudging === row.bookingId ? 'Sending…' : NUDGE_LABEL[nudge]}
                      </Button>
                    </span>
                  ) : null}
                  {nudgeErrors[row.bookingId] ? (
                    <span className="sub nudge-err" role="alert">
                      {nudgeErrors[row.bookingId]}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

/**
 * RULE-20 with ADR-0184: the paid overrun counts against the weekly cap, so
 * a late sign-out can take a worker past it. Amber, beside the late line —
 * the red stays on the status pill (§9.5).
 */
export function WeeklyLimitFlag({
  hours,
  cap,
}: {
  hours: number | null | undefined;
  cap: number | null | undefined;
}) {
  const text = overWeeklyLimitText(hours, cap);
  return text ? (
    <span className="sub">
      <Pill tone="amber">{text}</Pill>
    </span>
  ) : null;
}
