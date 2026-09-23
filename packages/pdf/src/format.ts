/**
 * Formatting shared by the §11.3 documents and the §9.9 CSVs.
 *
 * Everything here is in UK time (Europe/London) on purpose. A sheet that is
 * printed and signed on site, and a CSV that finance imports, are records
 * of a UK event — §1.8's "your time" second line is a screen affordance and
 * has no place on either.
 *
 * No imports: `csv.ts` depends on this file and is imported by the
 * `finance-reports` Edge Function under Deno (ADR-0006), so this module must
 * stay free of anything Node- or React-specific.
 */

export const UK_ZONE = 'Europe/London';

/** "THC-00412" — the form every Back Office screen prints (§2.7, §9.9). */
export function employeeIdLabel(id: number | null | undefined): string {
  return id === null || id === undefined ? '' : `THC-${String(id).padStart(5, '0')}`;
}

const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "18:00", UK wall clock. Empty for a missing instant. */
export function ukTime(at: string | Date | null | undefined): string {
  if (at === null || at === undefined || at === '') return '';
  return TIME.format(typeof at === 'string' ? new Date(at) : at);
}

/**
 * "19/09/2026" from an ISO date ("2026-09-19") — a calendar date, so it is
 * never passed through a zone.
 */
export function ukDateFromIsoDate(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "7h 30m", "6h 10m", "45m", "8h" — the Hours Worked cell (§11.3). */
export function hoursMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "0:20" — a break deduction, as §9.9's wireframe writes it. */
export function clockMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** "4.67" — payable minutes as decimal hours, two places. */
export function decimalHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  return (minutes / 60).toFixed(2);
}

/**
 * "72.33" from a numeric column. PostgREST may hand `numeric` back as a
 * number or a string; both are accepted, and the figure is never re-derived
 * here — the database priced it (§9.9).
 */
export function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '';
}
