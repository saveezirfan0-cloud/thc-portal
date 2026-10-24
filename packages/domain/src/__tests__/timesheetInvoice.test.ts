import { describe, expect, it } from 'vitest';
import {
  hhmmToHours,
  invoiceTotals,
  lineAmount,
  nextInvoiceDueDate,
  timesheetHours,
  timesheetMinutes,
} from '../timesheetInvoice.ts';

/** The worked examples of docs/legacy-invoicing-audit.md §4.1, held equal to the SQL in 939. */
describe('timesheetHours (to the minute)', () => {
  it.each([
    ['18:30', '02:00', 30, 7],
    ['17:00', '21:03', 0, 4.05],
    ['09:00', '17:00', 60, 7],
    ['12:00', '16:00', 0, 4],
    ['22:00', '06:00', 0, 8],
    ['10:00', '10:20', 0, 0.33],
    ['10:00', '10:40', 0, 0.67],
    ['09:00', '09:30', 45, 0],
    ['07:05:00', '09:35:00', 0, 2.5],
  ])('%s to %s less %i min = %d h', (s, e, brk, h) => {
    expect(timesheetHours(s, e, brk)).toBe(h);
  });

  it('is null for a time it cannot read', () => {
    expect(timesheetHours('nine', '17:00')).toBeNull();
    expect(timesheetHours('09:00', '25:00')).toBeNull();
    expect(timesheetMinutes('09:00', '09:61')).toBeNull();
  });

  it('a finish at the start is zero, not a full day (matches the trigger)', () => {
    expect(timesheetMinutes('09:00', '09:00')).toBe(0);
  });

  it('weekly hh:mm totals: 25:14 = 25.23', () => {
    expect(hhmmToHours('25:14')).toBe(25.23);
    expect(hhmmToHours('4:03')).toBe(4.05);
    expect(hhmmToHours('4:60')).toBeNull();
  });
});

describe('lineAmount (rounded to the penny, per line)', () => {
  it('6.5 x 17.77 = 115.505 prints 115.51 (half away from zero, no float drift)', () => {
    expect(lineAmount(6.5, 17.77)).toBe(115.51);
  });
  it('is hours x rate x staff', () => {
    expect(lineAmount(7, 18.98)).toBe(132.86);
    expect(lineAmount(4.05, 18.98)).toBe(76.87);
    expect(lineAmount(7, 18.98, 3)).toBe(398.58);
  });
  it('an expense is quantity x unit price', () => {
    expect(lineAmount(1, 13.9)).toBe(13.9);
    expect(lineAmount(6, 19.95)).toBe(119.7);
  });
  it('is zero for no hours', () => {
    expect(lineAmount(0, 17.77)).toBe(0);
  });
});

describe('invoiceTotals (sum of the printed lines; VAT on the subtotal)', () => {
  it('the 939 scenario: 132.86 + 76.87 + 13.90 = 223.63, VAT 44.73, total 268.36', () => {
    expect(invoiceTotals([{ amount: 132.86 }, { amount: 76.87 }, { amount: 13.9 }], 20)).toEqual({
      net: 223.63,
      vat: 44.73,
      total: 268.36,
    });
  });
  it('audit §4.1: 3,530.28 x 0.2 = 706.056 prints 706.06', () => {
    expect(invoiceTotals([{ amount: 3530.28 }], 20)).toEqual({
      net: 3530.28,
      vat: 706.06,
      total: 4236.34,
    });
  });
  it('the lines add up to the subtotal by construction (ADR-0210: no 1p drift)', () => {
    // The old tool kept 3085.6082 unrounded and printed 3,085.61 against lines adding to 3,085.62.
    const lines = [lineAmount(6.5, 17.77), lineAmount(6.5, 17.77), lineAmount(4.25, 19.52)];
    const printed = lines.reduce((a, b) => Math.round((a + b) * 100) / 100, 0);
    expect(invoiceTotals(lines.map((amount) => ({ amount })), 20).net).toBe(printed);
  });
  it('rounds VAT half up and handles a fractional rate', () => {
    expect(invoiceTotals([{ amount: 0.025 * 100 }], 20).vat).toBe(0.5);
    expect(invoiceTotals([{ amount: 100 }], 17.5).vat).toBe(17.5);
    expect(invoiceTotals([], 20)).toEqual({ net: 0, vat: 0, total: 0 });
  });
});

describe('nextInvoiceDueDate', () => {
  it('adds the client terms, else the default 7 days', () => {
    expect(nextInvoiceDueDate('2026-10-30', 14)).toBe('2026-11-13');
    expect(nextInvoiceDueDate('2026-10-30', null)).toBe('2026-11-06');
    expect(nextInvoiceDueDate('2026-10-30', undefined, 30)).toBe('2026-11-29');
  });
  it('crosses a year end and a leap day', () => {
    expect(nextInvoiceDueDate('2026-12-28', 7)).toBe('2027-01-04');
    expect(nextInvoiceDueDate('2028-02-25', 7)).toBe('2028-03-03');
  });
  it('0 days is the invoice date', () => {
    expect(nextInvoiceDueDate('2026-10-30', 0)).toBe('2026-10-30');
  });
  it('refuses a malformed date', () => {
    expect(() => nextInvoiceDueDate('30/10/2026', 7)).toThrow();
  });
});
