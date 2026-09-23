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
export function capReason(
  band: CapBand | null,
  capHours: number | null,
  /**
   * The Sunday this band holds until, where the calendar ends it. §9.6's
   * own example is "20 h — term time until 13.12.2026", and §8 gives N14
   * the same shape, so the date belongs in the sentence rather than
   * beside it.
   */
  until?: string | null,
): string {
  // `uncapped` is what the database's cap_band enum actually returns for no
  // ceiling; `opted_out_none` is kept for the rows and tests that predate it.
  if (band === 'opted_out_none' || band === 'uncapped') {
    return 'No weekly ceiling — 48h opt-out signed and no visa limit';
  }
  if (band === 'visa_expired_0') {
    return '0 h — right to work expired, cannot be rostered';
  }
  if (capHours === null) {
    return 'No cap to calculate — no verified term dates, so the worker cannot be booked';
  }
  const ends = until ? ` until ${formatUkDate(until)}` : '';
  switch (band) {
    case 'student_term_20':
      return `${capHours} h — term time${ends}`;
    case 'student_term_10':
      return `${capHours} h — term time, below degree level${ends}`;
    case 'student_holiday_48':
      return `${capHours} h — university holiday${ends}`;
    case 'graduated_48':
      return `${capHours} h — completion letter verified`;
    default:
      return `${capHours} h — standard weekly limit`;
  }
}

/**
 * §2.5's branches, as the office reads them. The enum is never printed:
 * nobody has an `international_student`, they are an International
 * student — the same reason doc_label() exists in SQL.
 */
export const RTW_LABEL: Record<string, string> = {
  uk_irish: 'UK or Irish citizen',
  eu_settled: 'EU settled or pre-settled status',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant or other',
};

/**
 * A Postgres `daterange` literal as the office reads it. The wire form is
 * `[2026-12-13,2027-01-10)` — half-open, so the printed end date is the
 * day BEFORE the bound, which is the day the holiday actually ends.
 */
export function formatDateRange(range: string): string {
  const match = /^([[(])([^,]*),([^)\]]*)([)\]])$/.exec(range.trim());
  if (!match) return range;
  const [, openBracket, rawFrom, rawTo, closeBracket] = match;
  if (!rawFrom || !rawTo) return range;

  const day = (iso: string, shift: number) => {
    const at = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(at.getTime())) return null;
    at.setUTCDate(at.getUTCDate() + shift);
    return at.toISOString().slice(0, 10);
  };

  const from = openBracket === '(' ? day(rawFrom, 1) : rawFrom;
  const to = closeBracket === ')' ? day(rawTo, -1) : rawTo;
  if (!from || !to) return range;
  return `${formatUkDate(from)} – ${formatUkDate(to)}`;
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

/**
 * §1.8: every date the office reads is a UK date.
 *
 * Both shapes reach this. A `date` column arrives as `2026-07-12`, which
 * has no instant at all until one is chosen, and midday UTC is the choice
 * that lands on the same calendar day in every zone the office might be
 * read from. A `timestamptz` arrives as a full ISO instant and must be
 * converted, not have a second time appended: the first version of this
 * built `2026-07-12T09:00:00ZT12:00:00Z` and produced an Invalid Date,
 * which crashed the profile on render.
 */
export function formatUkDate(iso: string): string {
  const at = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(at.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(at);
}

/** What a verified settled-status share code says instead of a date (§2.5 pt 2). */
export const SETTLED_NO_TIME_LIMIT = 'Settled — no time limit';

/**
 * The right-to-work line on a share code report: the date read off the
 * gov.uk report, or — on the EU settled branch — the reviewer's explicit
 * "no time limit" confirmation (`rtw_no_time_limit`, 20260923200000). A
 * blank date without that confirmation is still a blank: "—", never
 * "settled", because a forgotten date must not read as indefinite leave.
 */
export function rtwUntilLabel(doc: {
  right_to_work_until: string | null;
  rtw_no_time_limit?: boolean | null;
}): string {
  if (doc.right_to_work_until) return formatUkDate(doc.right_to_work_until);
  return doc.rtw_no_time_limit ? SETTLED_NO_TIME_LIMIT : '—';
}
