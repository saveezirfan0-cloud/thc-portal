import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { A4_POINTS, countPdfPages, pdfPageSizes } from '../SheetDocument';
import { renderInvoicePdf } from '../InvoiceDocument';
import {
  invoiceBreak,
  invoiceEventDates,
  invoiceFileName,
  invoiceMoney,
  invoiceRows,
  invoiceTerms,
  invoiceVatLabel,
} from '../invoice';
import type { InvoiceDocumentData, InvoiceLineData } from '../invoice';

/**
 * THC's own invoice (20.10.2026) as the database would issue it: PO 714981,
 * Mandarin Oriental Hyde Park, 14–17 Oct 2026 (BST), Food Waiting Staff at
 * £18.98. The figures are THC's, line for line.
 */
function line(
  date: string,
  name: string,
  start: string,
  end: string,
  breakMin: number,
  hours: number,
): InvoiceLineData {
  return {
    date,
    staffName: name,
    employeeId: null,
    role: 'Food Waiting Staff',
    startsAt: `${date}T${start}:00+01:00`,
    endsAt: `${end < start ? `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, '0')}` : date}T${end}:00+01:00`,
    breakMin,
    payableMin: Math.round(hours * 60),
    rate: '18.98',
    amount: (Math.round(hours * 18.98 * 100) / 100).toFixed(2),
    kind: 'worked',
  };
}

const LINES: InvoiceLineData[] = [
  line('2026-10-14', 'Stanley Jonas Charles Henri Sebastien', '07:00', '16:30', 30, 9),
  line('2026-10-14', 'Prabin Ayer', '14:30', '22:00', 30, 7),
  line('2026-10-15', 'Shreyas Krishnan', '15:00', '22:00', 30, 6.5),
  line('2026-10-15', 'Diya Nileshbhai Tandel', '17:00', '23:00', 30, 5.5),
  line('2026-10-15', 'Ayushman Padhy', '17:00', '23:00', 30, 5.5),
  line('2026-10-15', 'Rafael Dibacco Pires', '17:00', '23:00', 30, 5.5),
  line('2026-10-17', 'EYAD ABOU KUFA', '16:00', '22:00', 15, 5.75),
  line('2026-10-17', 'Mahesh Sapkota', '16:00', '02:00', 15, 9.75),
  line('2026-10-17', 'Ayushman Padhy', '16:00', '22:00', 15, 5.75),
  line('2026-10-17', 'Gabriel Paixao Seixas', '16:00', '02:00', 15, 9.75),
  line('2026-10-14', 'Ayushman Padhy', '07:00', '16:30', 30, 9),
  line('2026-10-14', 'Diya Tandel', '07:00', '16:30', 30, 9),
  line('2026-10-14', 'Abdul Hadi', '07:00', '16:30', 30, 9),
  line('2026-10-15', 'Mahesh Sapkota', '17:00', '02:00', 30, 8.5),
];

export const EXAMPLE: InvoiceDocumentData = {
  id: '00000000-0000-4000-8000-000000004000',
  number: 4000,
  invoiceDate: '2026-10-19',
  dueDate: '2026-10-26',
  periodFrom: '2026-10-14',
  periodTo: '2026-10-17',
  poNumber: '714981',
  payableMin: 6330,
  net: '2002.39',
  vatRate: '20.00',
  vat: '400.48',
  total: '2402.87',
  termsDays: 7,
  billTo: {
    name: 'Mandarin Oriental Hyde Park',
    contact: 'Paul Jordan',
    emails: ['pjordan@mohg.com'],
    address: 'Mandarin Oriental Hyde Park, 66 Knightsbridge, London, SW1X 7LA, UK',
  },
  seller: {
    company: {
      name: 'THE HOSPITALITY COMPANY (London) Ltd',
      company_reg: '12411407',
      vat_reg: '388046760',
      email: 'info@thehospitalitycompany.co.uk',
      website: 'www.thehospitalitycompany.co.uk',
    },
    bank: {
      account_name: 'THE HOSPITALITY COMPANY (London) Ltd',
      bank: 'Lloyds Bank',
      account_number: '14076660',
      sort_code: '30-15-99',
    },
    late_payment_note:
      'Invoices exceeding these payment terms will be passed to International Commercial Investigation Services for collection. A £35.00 late payment fee will be automatically added and the invoice will be subject to statutory interest and additional costs, including any costs incurred during the recovery process.',
  },
  recipients: ['pjordan@mohg.com'],
  events: [],
  lines: LINES,
};

describe('invoice words (ADR-0176)', () => {
  it('writes each line as THC’s invoice does', () => {
    expect(invoiceRows(LINES)[0]).toEqual([
      '14/10/2026',
      'Stanley Jonas Charles Henri Sebastien',
      'Food Waiting Staff',
      '07:00',
      '16:30',
      '30 mins',
      '9.00',
      '£18.98',
      '£170.82',
    ]);
    // A shift past midnight ends the next morning, still in UK time.
    expect(invoiceRows(LINES)[7]?.slice(3, 5)).toEqual(['16:00', '02:00']);
  });

  it('formats money, breaks, dates, VAT and terms', () => {
    expect(invoiceMoney('2002.39')).toBe('£2,002.39');
    expect(invoiceBreak(0)).toBe('—');
    expect(invoiceBreak(15)).toBe('15 mins');
    expect(invoiceBreak(75)).toBe('1 hr 15 mins');
    expect(invoiceEventDates('2026-10-14', '2026-10-17')).toBe('14/10/2026 to 17/10/2026');
    expect(invoiceEventDates('2026-10-14', '2026-10-14')).toBe('14/10/2026');
    expect(invoiceVatLabel('20.00')).toBe('VAT (20%)');
    expect(invoiceTerms(7)).toBe('Payable Within 7 Days from Date of Invoice');
  });

  it('names the file after the number, the client and the PO', () => {
    expect(invoiceFileName(EXAMPLE)).toBe(
      'Invoice 4000 – Mandarin Oriental Hyde Park – PO 714981.pdf',
    );
    expect(invoiceFileName({ ...EXAMPLE, poNumber: null, billTo: { name: 'A/B: Co' } })).toBe(
      'Invoice 4000 – A-B- Co.pdf',
    );
  });
});

describe('rendered invoice (ADR-0176)', () => {
  it('is an A4 PDF', async () => {
    const pdf = await renderInvoicePdf(EXAMPLE);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = countPdfPages(pdf);
    expect(pages).toBeGreaterThanOrEqual(1);
    for (const size of pdfPageSizes(pdf)) {
      expect(size.width).toBeCloseTo(A4_POINTS.width, 1);
      expect(size.height).toBeCloseTo(A4_POINTS.height, 1);
    }
    if (process.env.INVOICE_PREVIEW) writeFileSync(process.env.INVOICE_PREVIEW, pdf);
  });

  // 50 lines is more than one A4 page holds. A full render takes a few
  // seconds on a CI runner, so this one test is given 20 s, not vitest's 5.
  it('flows a long invoice over more pages', { timeout: 20_000 }, async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...LINES[i % LINES.length]! }));
    const pdf = await renderInvoicePdf({ ...EXAMPLE, lines: many });
    expect(countPdfPages(pdf)).toBeGreaterThan(1);
  });
});
