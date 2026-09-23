/**
 * The §9.9 CSVs — Payroll, New Starter (HMRC) and the Financial breakdown.
 *
 * One builder, two callers: the "Export CSV" buttons on /reports and the
 * BG-08 Monday send (`supabase/functions/finance-reports`, under Deno —
 * which is why this file imports nothing but `./format.ts`, with the
 * extension, per ADR-0006). The two must produce the same file for the same
 * rows, so neither of them formats a cell itself.
 *
 * Nothing here computes money. The rows arrive priced by the database
 * (`payroll_report`, `payroll_export_rows` in
 * 20260923130000_reports_and_finance_send.sql): base and holiday in their
 * own columns, never blended (§1.5, §9.9). This file only writes them down.
 *
 * The held-row rule is decided in SQL too — `in_export` is false for a shift
 * with an unresolved No check-out (and for a late turn-away, which is paid
 * nothing). `payrollCsv` still drops any row that says `in_export: false`,
 * so a caller that forgets to filter cannot put a pending shift in front of
 * finance with a guessed figure.
 */

import {
  clockMinutes,
  decimalHours,
  employeeIdLabel,
  money,
  ukDateFromIsoDate,
  ukTime,
} from './format.ts';

/** RFC 4180 with CRLF, and a BOM so Excel opens it as UTF-8 (accented names survive). */
const BOM = '\uFEFF';
const EOL = '\r\n';

/**
 * A spreadsheet treats a cell starting with = + - @ (or a tab / CR) as a
 * formula. Names and event titles are typed by people, so every TEXT cell is
 * defused with a leading apostrophe; numeric cells are written as numbers
 * and are not touched (a negative margin must stay a number).
 */
export function textCell(value: string | null | undefined): string {
  const s = value ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(quote).join(','));
  return BOM + lines.join(EOL) + EOL;
}

// ---------------------------------------------------------------------------
// Tab 2 · Payroll — one row per SHIFT, never averaged (§9.9)
// ---------------------------------------------------------------------------

/**
 * Column for column, the wireframe's list (reports.html, "CSV export"):
 * Employee ID · Staff · Event · Client · Role · Date · Scheduled start–end ·
 * Check in · Check out · Break deduction · Payable hours · Rate · Base ·
 * Holiday · Total.
 */
export const PAYROLL_CSV_COLUMNS = [
  'Employee ID',
  'Staff',
  'Event',
  'Client',
  'Role',
  'Date',
  'Scheduled start–end',
  'Check in',
  'Check out',
  'Break deduction',
  'Payable hours',
  'Rate',
  'Base',
  'Holiday',
  'Total',
] as const;

/** The shape both `payroll_report` and `payroll_export_rows` return. */
export interface PayrollCsvRow {
  employee_id: number | null;
  staff_name: string;
  event_title: string;
  client_name: string;
  role_name: string;
  /** ISO date, the shift's UK start date. */
  shift_date: string;
  starts_at: string;
  ends_at: string;
  check_in_at: string | null;
  check_out_at: string | null;
  /** worked · turned_away · cancelled_on_day (no_show never reaches a CSV). */
  kind: string;
  unpaid_break_min: number | null;
  payable_min: number | null;
  rate: number | string;
  base: number | string | null;
  holiday: number | string | null;
  total: number | string | null;
  /** False for a HELD shift (unresolved No check-out) and for £0 lines. */
  in_export?: boolean | null;
}

function checkInCell(row: PayrollCsvRow): string {
  if (row.kind === 'turned_away') return 'Turned away';
  if (row.kind === 'cancelled_on_day') return 'Event cancelled on the day';
  return ukTime(row.check_in_at);
}

export function payrollCsvRows(rows: readonly PayrollCsvRow[]): string[][] {
  return rows
    .filter((row) => row.in_export !== false)
    .map((row) => [
      employeeIdLabel(row.employee_id),
      textCell(row.staff_name),
      textCell(row.event_title),
      textCell(row.client_name),
      textCell(row.role_name),
      ukDateFromIsoDate(row.shift_date),
      `${ukTime(row.starts_at)}–${ukTime(row.ends_at)}`,
      checkInCell(row),
      row.kind === 'worked' ? ukTime(row.check_out_at) : '',
      clockMinutes(row.unpaid_break_min ?? 0),
      decimalHours(row.payable_min),
      money(row.rate),
      money(row.base),
      money(row.holiday),
      money(row.total),
    ]);
}

export function payrollCsv(rows: readonly PayrollCsvRow[]): string {
  return toCsv(PAYROLL_CSV_COLUMNS, payrollCsvRows(rows));
}

// ---------------------------------------------------------------------------
// Tab 3 · New Starter (HMRC) — entirely different columns, never merged
// ---------------------------------------------------------------------------

/**
 * Confirmed 28.07.2026: Staff · Employee ID · NI Number · Home address ·
 * Postcode · Country · Date of birth · Gender (M/F) · First shift date ·
 * HMRC Statement (A/B/C) · Student Loan. No role, no salutation.
 */
export const NEW_STARTER_CSV_COLUMNS = [
  'Staff',
  'Employee ID',
  'NI Number',
  'Home address',
  'Postcode',
  'Country',
  'Date of birth',
  'Gender',
  'First shift date',
  'HMRC Statement',
  'Student Loan',
] as const;

export interface NewStarterCsvRow {
  staff_name: string;
  employee_id: number | null;
  ni_number: string | null;
  home_address: string | null;
  postcode: string | null;
  country: string | null;
  date_of_birth: string | null;
  gender: string | null;
  first_shift_date: string | null;
  hmrc_statement: string | null;
  student_loan: string | null;
}

export function newStarterCsvRows(rows: readonly NewStarterCsvRow[]): string[][] {
  return rows.map((row) => [
    textCell(row.staff_name),
    employeeIdLabel(row.employee_id),
    // The full number, unmasked: this file goes to payroll, not a screen.
    textCell(row.ni_number),
    textCell(row.home_address),
    textCell(row.postcode),
    textCell(row.country),
    ukDateFromIsoDate(row.date_of_birth),
    textCell(row.gender),
    ukDateFromIsoDate(row.first_shift_date),
    textCell(row.hmrc_statement),
    textCell(row.student_loan),
  ]);
}

export function newStarterCsv(rows: readonly NewStarterCsvRow[]): string {
  return toCsv(NEW_STARTER_CSV_COLUMNS, newStarterCsvRows(rows));
}

// ---------------------------------------------------------------------------
// Tab 1 · Financial — the breakdown table, as shown
// ---------------------------------------------------------------------------

export const FINANCIAL_CSV_COLUMNS = [
  'Group',
  'Events',
  'Payable hours',
  'Base payroll',
  'Holiday +12.07%',
  'Payroll incl. holiday',
  'Invoicing (forecast)',
  'Margin',
  'Status',
] as const;

export interface FinancialCsvRow {
  group_label: string | null;
  is_total: boolean;
  events: readonly string[] | null;
  cancelled_events: readonly string[] | null;
  payable_min: number;
  base: number | string;
  holiday: number | string;
  payroll: number | string;
  invoicing: number | string;
  margin: number | string;
  actual_sections: number;
  forecast_sections: number;
  pending: number;
}

export function financialStatus(
  row: Pick<
    FinancialCsvRow,
    'actual_sections' | 'forecast_sections' | 'pending' | 'cancelled_events' | 'events'
  >,
): string {
  const parts: string[] = [];
  if (row.pending > 0) parts.push(`${row.pending} shift${row.pending === 1 ? '' : 's'} pending`);
  if (row.forecast_sections > 0 && row.actual_sections > 0) parts.push('actual + forecast');
  else if (row.forecast_sections > 0) parts.push('forecast');
  else if (row.actual_sections > 0) parts.push('actual');
  if ((row.cancelled_events?.length ?? 0) > 0) parts.push('cancelled · excluded');
  return parts.join(' · ');
}

export function financialCsv(rows: readonly FinancialCsvRow[]): string {
  return toCsv(
    FINANCIAL_CSV_COLUMNS,
    rows.map((row) => [
      row.is_total ? 'Total' : textCell(row.group_label),
      textCell((row.events ?? []).join(' · ')),
      decimalHours(row.payable_min),
      money(row.base),
      money(row.holiday),
      money(row.payroll),
      money(row.invoicing),
      money(row.margin),
      row.is_total ? '' : financialStatus(row),
    ]),
  );
}
