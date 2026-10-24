/**
 * Timesheet invoicing arithmetic (ADR-0210). The database is authoritative:
 * `timesheet_shift_compute()` and `issue_timesheet_invoice()` do the same
 * sums, and `timesheetInvoice.test.ts` holds the worked examples of
 * `docs/legacy-invoicing-audit.md` §4.1 against both.
 *
 * Everything is done in whole units (minutes, hundredths of an hour, pence)
 * so the rounding is Postgres `round(numeric, 2)` — half away from zero —
 * and never a floating-point accident (6.5 x 17.77 = 115.505 must be 115.51).
 *
 * One deliberate difference from the old tool (ADR-0210 §4): each line is
 * rounded to the penny, and the subtotal is the sum of the printed lines.
 */

const HHMM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

function minutesOfDay(t: string): number | null {
  const m = HHMM.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Whole minutes worked between two clock times, less the break. A finish at or before the start is the next day. */
export function timesheetMinutes(start: string, end: string, breakMin = 0): number | null {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s === null || e === null) return null;
  const span = (((e - s) % 1440) + 1440) % 1440;
  return Math.max(span - Math.max(0, Math.trunc(breakMin)), 0);
}

/**
 * Decimal hours to the minute, 2 dp: 18:30-02:00 less 30 min = 7.00;
 * 17:00-21:03 = 4.05 (4h03). Null when either time cannot be read.
 */
export function timesheetHours(start: string, end: string, breakMin = 0): number | null {
  const min = timesheetMinutes(start, end, breakMin);
  if (min === null) return null;
  return Math.floor((min * 100 + 30) / 60) / 100;
}

/** hh:mm weekly totals (Taster's export) to decimal hours, 2 dp: 25:14 = 25.23. */
export function hhmmToHours(hhmm: string): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[2]) > 59) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return Math.floor((min * 100 + 30) / 60) / 100;
}

const toHundredths = (n: number): number => Math.round(n * 100);

/**
 * One line: quantity (hours, or the quantity of an expense) x rate x staff
 * count, rounded to the penny, half away from zero. Returns pounds.
 */
export function lineAmount(hours: number, rate: number, staffCount = 1): number {
  const units = toHundredths(hours) * toHundredths(rate) * Math.max(1, Math.trunc(staffCount));
  // units are 1/10000 of a pound
  return Math.floor((units + 50) / 100) / 100;
}

export interface InvoiceTotals {
  /** Sum of the printed (rounded) lines. */
  net: number;
  /** round(net x rate / 100, 2). */
  vat: number;
  total: number;
}

/** Subtotal, VAT and total from the printed lines. `vatRate` is a percentage (20). */
export function invoiceTotals(lines: readonly { amount: number }[], vatRate = 20): InvoiceTotals {
  const netPence = lines.reduce((sum, l) => sum + toHundredths(l.amount), 0);
  const ratePct100 = Math.round(vatRate * 100);
  const vatPence = Math.floor((netPence * ratePct100 + 5000) / 10000);
  return {
    net: netPence / 100,
    vat: vatPence / 100,
    total: (netPence + vatPence) / 100,
  };
}

/** `YYYY-MM-DD` plus the client's payment terms (or the platform default, 7 days). */
export function nextInvoiceDueDate(
  invoiceDate: string,
  clientTermsDays: number | null | undefined,
  defaultTermsDays = 7,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(invoiceDate);
  if (!m) throw new Error(`Not a date: ${invoiceDate}`);
  const days = clientTermsDays ?? defaultTermsDays;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}
