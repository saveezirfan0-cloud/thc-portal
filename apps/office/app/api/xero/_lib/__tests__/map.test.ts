import { describe, expect, it } from 'vitest';
import { describeLine, mapInvoice } from '../map';
import type { DocData } from '../map';
import { DEFAULT_XERO_SETTINGS } from '../settings';
import { AUDIT_HOURS, AUDIT_LINE_COUNT, auditInvoice } from './fixtures';

const cents = (n: number) => Math.round(n * 100);

describe('the audit sample invoice (#3255) as a Xero invoice', () => {
  const doc = auditInvoice();
  const xero = mapInvoice(doc, 'contact-1', DEFAULT_XERO_SETTINGS);

  it('is the invoice the audit printed', () => {
    expect(AUDIT_LINE_COUNT).toBe(28);
    expect(AUDIT_HOURS).toBe(186);
    expect(doc.net).toBe(3530.28);
    expect(doc.vat).toBe(706.06);
    expect(doc.total).toBe(4236.34);
  });

  it('carries the header fields', () => {
    expect(xero).toMatchObject({
      Type: 'ACCREC',
      Contact: { ContactID: 'contact-1' },
      InvoiceNumber: '3255',
      Reference: '52453465',
      Date: '2026-10-20',
      DueDate: '2026-10-27',
      CurrencyCode: 'GBP',
      LineAmountTypes: 'Exclusive',
      Status: 'DRAFT',
    });
  });

  it('has one Xero line per invoice line row, with our amounts to the penny', () => {
    expect(xero.LineItems).toHaveLength(doc.lines.length);
    doc.lines.forEach((l, i) => {
      const x = xero.LineItems[i]!;
      expect(x.LineAmount).toBe(Number(l.amount));
      expect(x.AccountCode).toBe('200');
      expect(x.TaxType).toBe('OUTPUT2');
      // hours x staff x rate reproduces the amount, so Quantity x UnitAmount is shown.
      expect(x.Quantity).toBeCloseTo(Number(l.hours) * (l.staffCount ?? 1), 4);
      expect(x.UnitAmount).toBe(18.98);
      expect(cents(x.Quantity * x.UnitAmount)).toBe(cents(x.LineAmount));
    });
    expect(cents(xero.LineItems.reduce((s, l) => s + l.LineAmount, 0))).toBe(353028);
  });

  it("sets per-line tax because Xero's own per-line rounding would be 1p out on this invoice", () => {
    const naive = xero.LineItems.reduce((s, l) => s + Math.round(cents(l.LineAmount) * 0.2), 0);
    expect(naive).toBe(70607); // ours is 70606
    expect(xero.LineItems.every((l) => l.TaxAmount !== undefined)).toBe(true);
  });

  it('makes the VAT add up to ours, whichever way Xero would have rounded', () => {
    const vat = xero.LineItems.reduce(
      (s, l) =>
        s +
        (l.TaxAmount !== undefined ? cents(l.TaxAmount) : Math.round(cents(l.LineAmount) * 0.2)),
      0,
    );
    expect(vat).toBe(70606);
  });

  it('puts no staff names in Xero for an aggregated client', () => {
    const named: DocData = {
      ...doc,
      lines: doc.lines.map((l) => ({ ...l, staffName: 'Jane Worker' })),
    };
    const out = mapInvoice(named, 'c', DEFAULT_XERO_SETTINGS);
    expect(JSON.stringify(out)).not.toContain('Jane');
    expect(out.LineItems[0]!.Description).toBe(
      '17/10/2026 · Wine Waiting Staff M&E · 7 h · 3 staff',
    );
  });
});

describe('mapping rules', () => {
  const base: DocData = {
    number: 4001,
    invoiceDate: '2026-10-26',
    dueDate: '2026-11-02',
    poNumber: null,
    vatRate: 20,
    net: 0,
    vat: 0,
    total: 0,
    billTo: { name: 'Acme', format: 'named' },
    lines: [],
  };

  it('an event shift line shows the name, UK times and hours; quantity is payable hours', () => {
    const doc: DocData = {
      ...base,
      lines: [
        {
          date: '2026-07-04',
          staffName: 'Jane Worker',
          role: 'Bartender',
          // 19:00 and 23:30 BST
          startsAt: '2026-07-04T18:00:00Z',
          endsAt: '2026-07-04T22:30:00Z',
          breakMin: 30,
          payableMin: 240,
          rate: 20,
          amount: 80,
          kind: 'worked',
        },
      ],
    };
    const out = mapInvoice(doc, 'c', DEFAULT_XERO_SETTINGS);
    expect(out.LineItems[0]).toMatchObject({
      Description: '04/07/2026 · Bartender · Jane Worker · 19:00–23:30 · break 30 min · 4 h',
      Quantity: 4,
      UnitAmount: 20,
      LineAmount: 80,
    });
    expect(out.Reference).toBeUndefined();
  });

  it('an hours x rate that does not reproduce the stored amount becomes 1 x amount (our amount wins)', () => {
    // 4.05 h x 3 people x 17.77 = 215.9055 -> 215.91 stored; Quantity 12.15 x 17.77 = 215.9055
    // is fine, but a stored amount from an older rounding is kept exactly.
    const doc: DocData = {
      ...base,
      lines: [
        {
          date: '2026-10-12',
          staffName: 'A',
          role: 'Shift Leader',
          rate: 17.77,
          amount: 215.92,
          kind: 'timesheet',
          hours: 4.05,
          staffCount: 3,
        },
      ],
    };
    const out = mapInvoice(doc, 'c', DEFAULT_XERO_SETTINGS);
    expect(out.LineItems[0]).toMatchObject({ Quantity: 1, UnitAmount: 215.92, LineAmount: 215.92 });
    expect(out.LineItems[0]!.Description).toContain('12.15 × £17.77');
  });

  it('per-line rounding: each line is its own hours x rate, rounded to the penny', () => {
    const doc: DocData = {
      ...base,
      lines: [
        {
          date: '2026-10-12',
          staffName: 'A',
          role: 'R',
          rate: 17.77,
          amount: 174.5,
          kind: 'timesheet',
          hours: 9.82,
          staffCount: 1,
        },
        {
          date: '2026-10-12',
          staffName: 'B',
          role: 'R',
          rate: 19.52,
          amount: 528.41,
          kind: 'timesheet',
          hours: 27.07,
          staffCount: 1,
        },
      ],
    };
    const out = mapInvoice(doc, 'c', DEFAULT_XERO_SETTINGS);
    // 9.82 x 17.77 = 174.4966 -> 174.50 ; 27.07 x 19.52 = 528.4064 -> 528.41
    expect(out.LineItems.map((l) => [l.Quantity, l.UnitAmount, l.LineAmount])).toEqual([
      [9.82, 17.77, 174.5],
      [27.07, 19.52, 528.41],
    ]);
  });

  it('a custom (expense) line is quantity x unit price with its description', () => {
    const doc: DocData = {
      ...base,
      lines: [
        {
          date: '2026-10-14',
          staffName: '',
          role: 'Train fare',
          rate: 12.5,
          amount: 25,
          kind: 'custom',
          quantity: 2,
        },
      ],
    };
    expect(mapInvoice(doc, 'c', DEFAULT_XERO_SETTINGS).LineItems[0]).toMatchObject({
      Description: '14/10/2026 · Train fare',
      Quantity: 2,
      UnitAmount: 12.5,
      LineAmount: 25,
    });
  });

  it('an overrun line is labelled for what it is', () => {
    expect(
      describeLine(
        {
          date: '2026-10-21',
          role: 'Bartender',
          rate: 20,
          amount: 5,
          kind: 'overrun',
          staffName: 'J',
        },
        true,
        0.25,
      ),
    ).toBe('21/10/2026 · Overrun – Bartender · J · 0.25 h');
  });

  it('uses the configured account, tax type and status; 0% VAT is zero-rated', () => {
    const doc: DocData = {
      ...base,
      vatRate: 0,
      lines: [
        {
          date: '2026-10-12',
          role: 'R',
          rate: 10,
          amount: 10,
          kind: 'timesheet',
          hours: 1,
          staffCount: 1,
        },
      ],
    };
    const out = mapInvoice(doc, 'c', {
      ...DEFAULT_XERO_SETTINGS,
      invoice_status: 'AUTHORISED',
      sales_account_code: '210',
    });
    expect(out.Status).toBe('AUTHORISED');
    expect(out.LineItems[0]).toMatchObject({ AccountCode: '210', TaxType: 'ZERORATEDOUTPUT' });
  });
});
