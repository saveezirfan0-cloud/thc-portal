import type { CapBand, StaffRow } from './types';

/**
 * The directory's presentation rules (§9.6). Pure, so the three that are
 * easy to get wrong can be tested directly.
 */

/**
 * §9.6: "0–2.9 red · 3.0–3.9 amber · 4.0 and above green", confirmed
 * against the approved design. A worker with no rating yet is neither.
 */
export type RatingTone = 'coral' | 'amber' | 'green' | 'none';

export function ratingTone(rating: number | null): RatingTone {
  if (rating === null) return 'none';
  if (rating >= 4) return 'green';
  if (rating >= 3) return 'amber';
  return 'coral';
}

/**
 * §9.6: the "Limit reached" badge appears when the worker has reached the
 * calculated weekly cap for the current Mon–Sun week.
 *
 * A null cap is the 48h opt-out with no visa limit — no ceiling, so it can
 * never be reached. This is a per-week condition and NEVER a status: it
 * does not replace Compliant / Blocked / Removed (RULE-20).
 */
export function limitReached(row: {
  weekly_cap_hours: number | null;
  weekly_booked_hours: number | null;
}): boolean {
  if (row.weekly_cap_hours === null) return false;
  return (row.weekly_booked_hours ?? 0) >= row.weekly_cap_hours;
}

/**
 * The hover text behind the badge: the cap and the reason for it.
 *
 * Two different things produce a null cap and they must not read alike.
 * `opted_out_none` is a worker with no ceiling — the 48h opt-out signed
 * and no visa limit. A null band is a cap that could not be calculated at
 * all, which is a blocked student with no verified term letter: they
 * cannot be booked, which is the opposite of unlimited.
 */
export function capReason(band: CapBand | null, capHours: number | null): string {
  if (band === 'opted_out_none') {
    return 'No weekly ceiling — 48h opt-out signed and no visa limit';
  }
  if (capHours === null) {
    return 'No cap to calculate — no verified term dates, so the worker cannot be booked';
  }
  switch (band) {
    case 'student_term_20':
      return `${capHours} h — term time`;
    case 'student_holiday_48':
      return `${capHours} h — university holiday`;
    case 'graduated_48':
      return `${capHours} h — completion letter verified`;
    default:
      return `${capHours} h — standard weekly limit`;
  }
}

/** The five §9.6 filter tabs. Removed rows are shown, never hidden (§1.7). */
export type Filter = 'all' | 'compliant' | 'blocked' | 'inactive' | 'removed';

export function matchesFilter(row: StaffRow, filter: Filter): boolean {
  switch (filter) {
    case 'compliant':
      return row.status === 'compliant';
    case 'blocked':
      return row.status === 'blocked';
    case 'inactive':
      return row.status === 'inactive';
    case 'removed':
      return row.removed;
    default:
      return true;
  }
}

/**
 * Search runs over the name, the Employee ID and the phone (§9.6). The
 * phone is not on the directory row — it is personal data the list does
 * not print — so what is searchable here is the name and the ID.
 */
export function matchesQuery(row: StaffRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (row.display_name.toLowerCase().includes(needle)) return true;
  if (row.employee_id !== null && employeeId(row.employee_id).toLowerCase().includes(needle)) {
    return true;
  }
  return row.role_names.some((role) => role.toLowerCase().includes(needle));
}

/** "THC-00873" — the form the wireframe prints and a manager would type. */
export function employeeId(id: number | null): string {
  return id === null ? '—' : `THC-${String(id).padStart(5, '0')}`;
}

export function formatShowRate(reliability: number | null): string {
  return reliability === null ? '—' : `${Math.round(reliability)}%`;
}

export function formatRating(rating: number | null): string {
  return rating === null ? '—' : rating.toFixed(1);
}

/** §1.8: every date the office reads is a UK date. */
export function formatUkDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(`${iso}T12:00:00Z`));
}
