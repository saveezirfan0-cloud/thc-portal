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
