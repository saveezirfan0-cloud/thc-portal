/**
 * The words of a timesheet invoice (ADR-0210) — decided here, drawn by
 * `TimesheetInvoiceDocument.tsx` (PDF) and `invoiceXlsx.ts` (workbook), so
 * the two never disagree.
 *
 * Two layouts, chosen by `billTo.format`:
 *   named       DATE · STAFF NAME · ROLE · START · END · BREAK · HOURS · RATE · TOTAL
 *   aggregated  DATE · ROLE · START · END · BREAK · NO. OF STAFF · HOURS · RATE · TOTAL
 * The DATE header is the client's own word (`billTo.dateLabel`, Taster's
 * "W/C Date"). An aggregated invoice prints no staff name anywhere.
 *
 * Nothing is priced here. Every printed line is the stored, penny-rounded
 * `amount` (ADR-0210 §4), so the printed lines add up to the Subtotal
 * exactly. Times are UK 24-hour (§1.8); a weekly row with no clock times and
 * an expense line print "-".
 */

import { invoiceBreak, invoiceDate, invoiceMoney, invoiceTime } from './invoice.ts';
import type { InvoiceDocumentData, InvoiceLineData } from './invoice.ts';

export type TimesheetFormat = 'named' | 'aggregated';

export const TIMESHEET_KIND_CUSTOM = 'custom';

const NAMED = [
  'DATE',
  'STAFF NAME',
  'ROLE',
  'START',
  'END',
  'BREAK',
  'HOURS',
  'RATE',
  'TOTAL',
] as const;
const AGGREGATED = [
  'DATE',
  'ROLE',
  'START',
  'END',
  'BREAK',
  'NO. OF STAFF',
  'HOURS',
  'RATE',
  'TOTAL',
] as const;

const n = (v: number | string | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : typeof v === 'number' ? v : Number(v);

export function timesheetFormat(data: Pick<InvoiceDocumentData, 'billTo'>): TimesheetFormat {
  return data.billTo.format === 'aggregated' ? 'aggregated' : 'named';
}

/** The nine headers; the DATE one is the client's label ("W/C DATE"). */
export function timesheetColumns(data: Pick<InvoiceDocumentData, 'billTo'>): readonly string[] {
  const base = timesheetFormat(data) === 'aggregated' ? AGGREGATED : NAMED;
  const label = data.billTo.dateLabel?.trim();
  return label ? [label.toUpperCase(), ...base.slice(1)] : base;
}

/** Column widths in points, 539 in all (A4 between 28pt margins). */
export function timesheetWidths(data: Pick<InvoiceDocumentData, 'billTo'>): readonly number[] {
  return timesheetFormat(data) === 'aggregated'
    ? [60, 150, 40, 40, 48, 40, 44, 52, 65]
    : [56, 108, 92, 38, 38, 50, 44, 50, 63];
}

/** Indexes of the right-aligned numeric columns. */
export const TIMESHEET_RIGHT = new Set([6, 7, 8]);

/** Where the word "Totals" sits in the totals row (before HOURS). */
export const TIMESHEET_TOTALS_AT = 5;

const isCustom = (l: Pick<InvoiceLineData, 'kind'>) => l.kind === TIMESHEET_KIND_CUSTOM;

/** Hours a line charges per person (an expense: its quantity). */
export function lineHours(l: InvoiceLineData): number {
  if (isCustom(l)) return n(l.quantity);
  return l.hours === null || l.hours === undefined ? n(l.payableMin) / 60 : n(l.hours);
}

const staffCount = (l: InvoiceLineData): number =>
  isCustom(l) ? 1 : l.staffCount && l.staffCount > 0 ? l.staffCount : 1;

/** "4.05". */
export const timesheetHours = (h: number): string => h.toFixed(2);

/** Σ hours x staff over the shift lines. Expenses add none. */
export function timesheetTotalHours(lines: readonly InvoiceLineData[]): number {
  const total = lines.reduce((a, l) => a + (isCustom(l) ? 0 : lineHours(l) * staffCount(l)), 0);
  return Math.round(total * 100) / 100;
}

/** Date, then as stored (Array.sort is stable). */
export function timesheetSorted(lines: readonly InvoiceLineData[]): InvoiceLineData[] {
  return [...lines].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

const DASH = '-';
const time = (iso: string | null | undefined) => (iso ? invoiceTime(iso) : DASH);
const breakCell = (l: InvoiceLineData) =>
  isCustom(l) || !l.startsAt || !l.endsAt || !l.breakMin ? DASH : invoiceBreak(l.breakMin);

/** One printed row per line, in the invoice's column order. */
export function timesheetRows(data: InvoiceDocumentData): string[][] {
  const aggregated = timesheetFormat(data) === 'aggregated';
  return timesheetSorted(data.lines).map((l) => {
    const custom = isCustom(l);
    const date = l.date ? invoiceDate(l.date) : DASH;
    const role = l.role || DASH;
    const clock = custom ? [DASH, DASH] : [time(l.startsAt), time(l.endsAt)];
    const tail = [timesheetHours(lineHours(l)), invoiceMoney(l.rate), invoiceMoney(l.amount)];
    return aggregated
      ? [date, role, ...clock, breakCell(l), custom ? DASH : String(staffCount(l)), ...tail]
      : [date, custom ? '' : l.staffName, role, ...clock, breakCell(l), ...tail];
  });
}

/** The totals row: "Totals", total hours, the sum of the printed amounts. */
export function timesheetTotalsRow(data: InvoiceDocumentData): string[] {
  const cells = Array<string>(9).fill('');
  cells[TIMESHEET_TOTALS_AT] = 'Totals';
  cells[6] = timesheetHours(timesheetTotalHours(data.lines));
  cells[8] = invoiceMoney(data.net);
  return cells;
}

/** "Invoice details" rows. PO is left out when blank; the due date is printed. */
export function timesheetDetails(data: InvoiceDocumentData): [string, string][] {
  const rows: [string, string][] = [
    ['Invoice Number:', String(data.number)],
    ['Invoice Date:', invoiceDate(data.invoiceDate)],
    [
      'Event Date:',
      data.periodFrom === data.periodTo
        ? invoiceDate(data.periodFrom)
        : `${invoiceDate(data.periodFrom)} to ${invoiceDate(data.periodTo)}`,
    ],
  ];
  if (data.poNumber?.trim()) rows.push(['PO Number:', data.poNumber.trim()]);
  rows.push(['Due Date:', invoiceDate(data.dueDate)]);
  return rows;
}

/** The "Invoice to" lines: contact, first email, venue, venue address, billing address. */
export function timesheetBillTo(data: InvoiceDocumentData): { name: string; lines: string[] } {
  const b = data.billTo;
  const lines = [b.contact, (b.emails ?? [])[0], b.venue, b.venueAddress, b.address]
    .map((x) => (x ?? '').trim())
    .filter((x, i, all) => x !== '' && all.indexOf(x) === i);
  return { name: b.name, lines };
}

const strip = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The old tool's pattern, kept so the accounts team's folders still sort:
 * "Leonardo Hotels St Pauls M E - Inv 4000 - w-c 15-10-2026 - 52453465.pdf".
 * `ext` is 'pdf' or 'xlsx'.
 */
export function timesheetInvoiceFileName(
  data: Pick<InvoiceDocumentData, 'number' | 'billTo' | 'poNumber' | 'periodFrom'>,
  ext: string,
): string {
  const parts = [
    strip(data.billTo.name) || 'Invoice',
    `Inv ${data.number}`,
    `w-c ${invoiceDate(data.periodFrom).replace(/\//g, '-')}`,
  ];
  const po = strip(data.poNumber ?? '');
  if (po) parts.push(po);
  return `${parts.join(' - ')}.${ext.replace(/^\./, '')}`;
}
