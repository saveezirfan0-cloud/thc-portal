/**
 * Formatting for the invoicing screens (ADR-0210). Pure.
 *
 * Calendar dates (`invoice_date`, a line's date) are written dd/mm/yyyy and
 * never pass through a zone; instants (created, sent, voided) are audit
 * stamps and so UK-only (CLAUDE.md, §1.8), 24-hour.
 */

const UK_ZONE = 'Europe/London';

const POUNDS = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});

export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** "£1,234.50". */
export function pounds(value: number | string | null | undefined): string {
  return POUNDS.format(num(value));
}

/** Whole pence, so sums of many invoices never drift (0.1 + 0.2). */
export function pence(value: number | string | null | undefined): number {
  return Math.round(num(value) * 100);
}

export function fromPence(value: number): number {
  return value / 100;
}

/** "25951.41" style hours from minutes, two places. */
export function hoursFromMin(minutes: number | null | undefined): number {
  return Math.round(((minutes ?? 0) / 60) * 100) / 100;
}

const NUMBER2 = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1,471.84". */
export function hours(value: number | null | undefined): string {
  return NUMBER2.format(value ?? 0);
}

/** "20/10/2026" from "2026-10-20". */
export function ukDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

const STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "20/10/2026 21:34", UK time. */
export function ukStamp(instant: string | null | undefined): string {
  if (!instant) return '—';
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '—';
  const parts = Object.fromEntries(STAMP.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts['day']}/${parts['month']}/${parts['year']} ${parts['hour']}:${parts['minute']}`;
}

/** "17 Oct" — a short day for the week headings. */
const MONTHS_SHORT = [
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
];
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1] ?? ''}`;
}

/** "Employee ID" as the rest of the Back Office prints it. */
export function employeeIdLabel(id: number | null | undefined): string {
  return id === null || id === undefined ? '' : `THC-${String(id).padStart(5, '0')}`;
}
