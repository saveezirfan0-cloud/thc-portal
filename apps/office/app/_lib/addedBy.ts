/**
 * "Date added" and "Added by" for the two hand-kept directories, /venues
 * (§9.11) and /clients (§9.7).
 *
 * Both lists get the same two columns and the same two filters, so the
 * rules live once, here. The stamp is an audit stamp: always Europe/London,
 * never the viewer's zone (§1.8), and a "day" for the date filter is a UK
 * calendar day, so a venue added at 00:30 BST on the 4th is on the 4th
 * whatever the browser's zone says.
 */

/** The shape both directory rows share (venue_directory_v / clients_directory_v). */
export interface Added {
  created_at: string;
  /** NULL for rows that pre-date the column or were written without a session. */
  created_by: string | null;
  created_by_name: string | null;
}

/** The "Added by" filter's value for rows with nobody recorded. */
export const ADDED_BY_NOBODY = 'nobody';
/** The "Added by" filter's value for no filtering at all. */
export const ADDED_BY_ANYONE = '';

export interface AddedFilter {
  /** `ADDED_BY_ANYONE`, `ADDED_BY_NOBODY`, or a profile id. */
  by: string;
  /** Inclusive UK calendar day, `YYYY-MM-DD`, or '' for no lower bound. */
  from: string;
  /** Inclusive UK calendar day, `YYYY-MM-DD`, or '' for no upper bound. */
  to: string;
}

export const NO_ADDED_FILTER: AddedFilter = { by: ADDED_BY_ANYONE, from: '', to: '' };

/** Spelled out so ICU's "Sept" never leaks in (the same list shift.ts uses). */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function ukParts(instant: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The UK calendar day of an instant, `YYYY-MM-DD` — compares as a string. */
export function ukDateKey(iso: string): string {
  const { year, month, day } = ukParts(new Date(iso));
  return `${year}-${month}-${day}`;
}

/** "4 Oct 2026" in UK time. */
export function formatDateAdded(iso: string): string {
  const { year, month, day } = ukParts(new Date(iso));
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}

export interface AddedByOption {
  value: string;
  label: string;
}

/**
 * The managers who have added at least one of these rows, by name, and
 * whether any row has nobody recorded. Built from the rows on the page, so
 * the picker never offers a manager who would match nothing.
 */
export function addedByOptions(rows: readonly Added[]): {
  managers: AddedByOption[];
  hasNobody: boolean;
} {
  const names = new Map<string, string>();
  let hasNobody = false;
  for (const row of rows) {
    if (row.created_by && row.created_by_name) names.set(row.created_by, row.created_by_name);
    else hasNobody = true;
  }
  const managers = [...names]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { managers, hasNobody };
}

/** True when a row passes the Added-by and Date-added filters. */
export function matchesAdded(row: Added, filter: AddedFilter): boolean {
  if (filter.by === ADDED_BY_NOBODY) {
    if (row.created_by && row.created_by_name) return false;
  } else if (filter.by !== ADDED_BY_ANYONE && row.created_by !== filter.by) {
    return false;
  }

  if (filter.from || filter.to) {
    const day = ukDateKey(row.created_at);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
  }
  return true;
}

/** True when any of the two filters is narrowing the list. */
export function addedFilterActive(filter: AddedFilter): boolean {
  return filter.by !== ADDED_BY_ANYONE || filter.from !== '' || filter.to !== '';
}
