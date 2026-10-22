import type { MonitorRow, MonitorStatus, ViolationType } from './types';

/**
 * How each §9.5 Status renders. The colour lives on the pill and never on
 * the row: "the monitor table has no row-level red state".
 */
export const STATUS_LABEL: Record<MonitorStatus, string> = {
  checked_out: 'Checked out',
  no_check_out: 'No check-out',
  off_site: 'Off-site',
  on_shift: 'On shift',
  not_checked_in: 'Not checked in — 30 min alert',
  not_confirmed_today: 'Not confirmed today',
  due: 'Due',
};

/**
 * The words on the Status pill. Two of them carry a time, and both are the
 * VIEWER's clock with no zone suffix (§1.8): "Checked out 22:48" is an actual
 * stamp, and "Due 17:00" is the one scheduled time §1.8 deliberately shows in
 * local time only — the pill is too narrow for a label, and the Window column
 * beside it already carries UK and local (audit D30).
 */
export function statusLabel(
  row: Pick<MonitorRow, 'status' | 'checkOutAt' | 'startsAt'>,
  local: (iso: string) => string,
): string {
  if (row.status === 'checked_out' && row.checkOutAt) {
    return `${STATUS_LABEL.checked_out} ${local(row.checkOutAt)}`;
  }
  if (row.status === 'due') return `${STATUS_LABEL.due} ${local(row.startsAt)}`;
  return STATUS_LABEL[row.status];
}

export type PillTone = 'green' | 'amber' | 'coral' | 'neutral';

/**
 * ADR-0184. A recorded finish more than 15 minutes past the section's end is
 * a late sign-out: paid and charged to that finish, the time past the end
 * its own line on the client's invoice, and flagged for the office to
 * verify with the worker. Until somebody has, the row needs attention.
 * Nothing about pay or invoicing waits for it.
 */
export function lateCheckOutToVerify(
  row: Pick<MonitorRow, 'status' | 'lateCheckOut' | 'lateCheckOutVerifiedAt'>,
): boolean {
  return row.status === 'checked_out' && row.lateCheckOut && !row.lateCheckOutVerifiedAt;
}

/** The words under the red pill (ADR-0184). */
export const LATE_CHECK_OUT_LABEL = 'Signed out late — verify with the worker';

/** Whole minutes from the scheduled end to the recorded finish. */
export function minutesPastEnd(endsAt: string, checkOutAt: string): number {
  return Math.round((new Date(checkOutAt).getTime() - new Date(endsAt).getTime()) / 60_000);
}

/** "1 h 15 min past the end", "45 min past the end". */
export function pastEndText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min'} past the end`;
}

/**
 * §9.5's colours. A checked-out row is neutral unless the recorded finish
 * was more than 15 minutes late, which turns it red until the office has
 * verified it with the worker. The shift is paid and charged to that
 * finish either way (ADR-0184); the red is for the conversation, not the
 * money.
 */
export function statusTone(
  row: Pick<MonitorRow, 'status' | 'lateCheckOut' | 'lateCheckOutVerifiedAt'>,
): PillTone {
  switch (row.status) {
    case 'on_shift':
      return 'green';
    case 'off_site':
    case 'due':
    case 'not_confirmed_today':
      return 'amber';
    case 'no_check_out':
    case 'not_checked_in':
      return 'coral';
    case 'checked_out':
      return lateCheckOutToVerify(row) ? 'coral' : 'neutral';
  }
}

/** The rows a manager has to do something about, for the "Needs attention" filter. */
export function needsAttention(row: MonitorRow): boolean {
  return (
    row.status === 'not_checked_in' ||
    row.status === 'no_check_out' ||
    row.status === 'off_site' ||
    lateCheckOutToVerify(row)
  );
}

/** What the monitor's Remind button can send (ADR-0188). */
export type NudgeKind = 'check-in' | 'check-out' | 'still-on-shift';

/** The window either side of a start / end the register's N9 uses, and the worker's check-in opens by. */
const NUDGE_OPENS_MIN = 30;

/**
 * Whether the Remind button is offered on a row, and which register push it
 * sends: N9 "Time to check in" (Due, Not confirmed today, Not checked in —
 * from 30 minutes before the start, until the end), N9 "Don't forget to check
 * out" (on shift, last 30 minutes), N9b "You haven't checked out of {event}"
 * (on shift past the end). A checked-out or No check-out row has nothing to
 * ask for: the first is done, the second's button is locked and the office
 * resolves it in the violation log.
 *
 * `nudge_check_in_out()` (20261023130000) decides the same from the same
 * status and refuses otherwise; this only keeps the button off rows that
 * would be refused. Pure on `now` so the board can pass a mount-guarded one.
 */
export function nudgeKind(
  row: Pick<MonitorRow, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
): NudgeKind | null {
  const at = now.getTime();
  const start = new Date(row.startsAt).getTime();
  const end = new Date(row.endsAt).getTime();
  const window = NUDGE_OPENS_MIN * 60_000;
  switch (row.status) {
    case 'due':
    case 'not_confirmed_today':
    case 'not_checked_in':
      return at >= start - window && at < end ? 'check-in' : null;
    case 'on_shift':
    case 'off_site':
      if (at >= end) return 'still-on-shift';
      return at >= end - window ? 'check-out' : null;
    default:
      return null;
  }
}

export const NUDGE_LABEL: Record<NudgeKind, string> = {
  'check-in': 'Remind to check in',
  'check-out': 'Remind to check out',
  'still-on-shift': 'Remind to check out',
};

/**
 * §9.5's "−1 worker" flag: the event is short because somebody has not
 * checked in and the clock has already passed the 30-minute alert.
 */
export function missingWorkers(rows: MonitorRow[]): number {
  return rows.filter((r) => r.status === 'not_checked_in').length;
}

/**
 * The Breaks column. §9.5: a dash where the client pays, because "no data"
 * and "took no breaks" must not look the same to a manager — and never a
 * bare 0 for the former.
 */
export function breaksCell(
  row: Pick<MonitorRow, 'breaksCount' | 'lastBreakAt'>,
  formatTime: (iso: string) => string,
): string {
  if (row.breaksCount === null) return '—';
  if (row.breaksCount === 0) return '0';
  return row.lastBreakAt
    ? `${row.breaksCount} · last ${formatTime(row.lastBreakAt)}`
    : String(row.breaksCount);
}

/**
 * The check-in stamp's second line, as `checkin.html` draws it: "GPS · on
 * site · 3 min late", "GPS · on site · early", "GPS · on site · on time".
 *
 * A check-in is only ever recorded inside the geofence (§5.1), so a stamp
 * is "on site" by construction — except where the fix behind it was too
 * vague to trust (`location_suspect`), which keeps its own amber pill and
 * says nothing about the site here. The lateness is the stamp against the
 * ROLE SECTION's start (RULE-18), in whole minutes: "21 min late" is inside
 * the 30-minute grace that makes it a Late violation (§9.5). Null when
 * there is no check-in.
 */
export function arrivalLine(
  row: Pick<MonitorRow, 'checkInAt' | 'startsAt' | 'locationSuspect'>,
): string | null {
  if (!row.checkInAt) return null;
  const minutes = Math.floor(
    (new Date(row.checkInAt).getTime() - new Date(row.startsAt).getTime()) / 60_000,
  );
  const timing = minutes > 0 ? `${minutes} min late` : minutes < 0 ? 'early' : 'on time';
  return row.locationSuspect ? `GPS · ${timing}` : `GPS · on site · ${timing}`;
}

export const VIOLATION_LABEL: Record<ViolationType, string> = {
  no_show: 'No-show',
  late: 'Late',
  left_early: 'Left early',
  left_geofence: 'Left the geofence during the shift',
  no_checkout: 'No check-out',
};

/**
 * What the log calls a violation (ADR-0185): a Left early the client or site
 * manager released is "Completed early" — it does not count against the
 * worker — and one still inside its sign-off window says so.
 */
export function violationLabel(v: {
  type: ViolationType;
  earlyFinish?: 'pending' | 'left_early' | 'completed_early';
}): string {
  if (v.type === 'left_early') {
    if (v.earlyFinish === 'completed_early') return 'Completed early';
    if (v.earlyFinish === 'pending') return 'Left early · awaiting sign-off';
  }
  return VIOLATION_LABEL[v.type];
}

/** Only a No check-out needs the manager to supply a finish time (§9.5). */
export function needsActualFinish(type: ViolationType): boolean {
  return type === 'no_checkout';
}

/** Resolving a No-show is the same action as "Get back" (§3.3). */
export function reclassifiesToLate(type: ViolationType): boolean {
  return type === 'no_show';
}
