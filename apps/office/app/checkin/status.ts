import { UK_ZONE, formatTimeIn } from '@thc/domain';
import type { MonitorRow, MonitorStatus, ViolationRow, ViolationType } from './types';

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

export type PillTone = 'green' | 'amber' | 'coral' | 'neutral';

/**
 * §9.5's colours. A checked-out row is neutral unless the recorded finish
 * was more than 15 minutes late, which turns it red for the manager to
 * verify — RULE-01 still caps the pay at the scheduled end either way.
 */
export function statusTone(row: Pick<MonitorRow, 'status' | 'lateCheckOut'>): PillTone {
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
      return row.lateCheckOut ? 'coral' : 'neutral';
  }
}

/** The rows a manager has to do something about, for the "Needs attention" filter. */
export function needsAttention(row: MonitorRow): boolean {
  return (
    row.status === 'not_checked_in' ||
    row.status === 'no_check_out' ||
    row.status === 'off_site' ||
    (row.status === 'checked_out' && row.lateCheckOut)
  );
}

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

/** True when an ISO string names its zone ("…Z" or "…+01:00"); a bare wall clock does not. */
export function carriesZone(iso: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim());
}

/**
 * The clock on the "Due [scheduled start time]" pill (§1.8): the reader's
 * LOCAL time, with no zone suffix — the one deliberate exception to the
 * dual display, "intentional and must not be 'fixed' back to UK time". The
 * WINDOW column beside it carries the UK reference, and keeping the pill
 * in the same zone as the check-in stamps is what makes the lateness
 * arithmetic on the row read correctly. A value with no zone to convert
 * from falls back to UK, as the scope says.
 */
export function duePillTime(startsAt: string, zone: string): string {
  return formatTimeIn(new Date(startsAt), carriesZone(startsAt) ? zone : UK_ZONE);
}

const YMD: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };

/**
 * The violation log's Time column (checkin.html: "today 16:12", "Wed 17 ·
 * 22:48"). An actual stamp, so the reader's own zone (§1.8); the day is
 * spelled for anything not detected today, because the log holds the last
 * hundred entries and two "19:30"s a week apart must not read alike.
 */
export function logTime(iso: string, zone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { ...YMD, timeZone: zone }).format(d);
  const clock = formatTimeIn(at, zone);
  if (day(at) === day(now)) return `today ${clock}`;
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: zone,
  }).format(at);
  return `${weekday} · ${clock}`;
}

/**
 * The window's "Flagged as" line (§9.5): the violation name plus the event
 * name, "kept as-is for v1 rather than reworked". The scope describes it as
 * server-composed; this build has no server string for it, so the same two
 * values are joined here — it is a label, not a rule.
 */
export function flaggedAs(v: Pick<ViolationRow, 'type' | 'eventTitle'>): string {
  return `${VIOLATION_LABEL[v.type]} — ${v.eventTitle}`;
}

export const VIOLATION_LABEL: Record<ViolationType, string> = {
  no_show: 'No-show',
  late: 'Late',
  left_early: 'Left early',
  left_geofence: 'Left the geofence during the shift',
  no_checkout: 'No check-out',
};

/** Only a No check-out needs the manager to supply a finish time (§9.5). */
export function needsActualFinish(type: ViolationType): boolean {
  return type === 'no_checkout';
}

/** Resolving a No-show is the same action as "Get back" (§3.3). */
export function reclassifiesToLate(type: ViolationType): boolean {
  return type === 'no_show';
}
