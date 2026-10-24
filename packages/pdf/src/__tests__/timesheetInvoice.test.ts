import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { A4_POINTS, countPdfPages, pdfPageSizes } from '../SheetDocument';
import { renderInvoiceXlsx } from '../invoiceXlsx';
import { renderTimesheetInvoicePdf } from '../TimesheetInvoiceDocument';
import {
  timesheetColumns,
  timesheetDetails,
  timesheetInvoiceFileName,
  timesheetRows,
  timesheetTotalHours,
  timesheetTotalsRow,
} from '../timesheetInvoice';
import type { InvoiceDocumentData, InvoiceLineData } from '../invoice';
import { EXAMPLE } from './invoice.test';

/**
 * The legacy audit's three sample invoices (docs/legacy-invoicing-audit.md
 * 4.3) rebuilt as the database now issues them (ADR-0210): every line is
 * rounded to the penny, the subtotal is the sum of the printed lines.
 */
const pence = (v: number) => Math.round(v * 100) / 100;
const sum = (ls: InvoiceLineData[]) => pence(ls.reduce((a, l) => a + Number(l.amount), 0));

function shift(
  date: string,
  role: string,
  start: string | null,
  end: string | null,
  breakMin: number,
  hours: number,
  rate: number,
  extra: Partial<InvoiceLineData> = {},
): InvoiceLineData {
  const next = end && start && end <= start;
  const endDate = next ? `2026-10-${String(Number(date.slice(8)) + 1).padStart(2, '0')}` : date;
  const staffCount = extra.staffCount ?? 1;
  return {
    date,
    staffName: '',
    employeeId: null,
    role,
    startsAt: start ? `${date}T${start}:00+01:00` : null,
    endsAt: end ? `${endDate}T${end}:00+01:00` : null,
    breakMin,
    payableMin: Math.round(hours * 60),
    rate: rate.toFixed(2),
    amount: pence(hours * rate * staffCount).toFixed(2),
    kind: 'timesheet',
    hours: hours.toFixed(2),
    staffCount,
    ...extra,
  };
}

function invoice(
  base: Partial<InvoiceDocumentData>,
  lines: InvoiceLineData[],
): InvoiceDocumentData {
  const net = sum(lines);
  const vat = pence(net * 0.2);
  return {
    ...EXAMPLE,
    source: 'timesheet',
    poNumber: null,
    termsDays: 7,
    lines,
    payableMin: 0,
    net: net.toFixed(2),
    vat: vat.toFixed(2),
    total: pence(net + vat).toFixed(2),
    ...base,
  };
}

const R = 18.98;
// #3255 Leonardo St Paul's M+E: aggregated, PO, 28 lines of 1, 186.00 h.
const l3255: InvoiceLineData[] = [
  ...[1, 2, 3].map(() => shift('2026-10-17', 'Wine Waiting Staff M&E', '18:30', '02:00', 30, 7, R)),
  ...[1, 2, 3, 4].map(() =>
    shift('2026-10-17', 'Food Waiting Staff M&E', '19:00', '23:00', 0, 4, R),
  ),
  ...[1, 2].map(() => shift('2026-10-17', 'TEAM LEAD', '19:00', '23:00', 0, 4, R)),
  ...[1, 2].map(() =>
    shift('2026-10-15', 'Food Waiting Staff M&E MINUS 1', '07:00', '16:00', 30, 8.5, R),
  ),
  ...[1, 2, 3, 4].map(() =>
    shift('2026-10-15', 'Food Waiting Staff M&E MINUS 2', '08:30', '16:00', 30, 7, R),
  ),
  shift('2026-10-15', 'Cloakroom Staff M&E', '08:30', '17:30', 30, 8.5, R),
  ...[1, 2, 3, 4, 5].map(() =>
    shift('2026-10-15', 'Food Waiting Staff M&E', '10:00', '21:00', 30, 10.5, R),
  ),
  shift('2026-10-15', 'Food Waiting Staff M&E', '10:30', '16:00', 0, 5.5, R),
  shift('2026-10-15', 'Food Waiting Staff M&E', '11:30', '16:00', 0, 4.5, R),
  shift('2026-10-15', 'Food Waiting Staff M&E', '11:30', '21:00', 30, 9, R),
  ...[1, 2, 3, 4].map(() =>
    shift('2026-10-15', 'Food Waiting Staff M&E', '17:00', '21:00', 0, 4, R),
  ),
];
const I3255 = invoice(
  {
    number: 3255,
    invoiceDate: '2026-10-20',
    dueDate: '2026-10-27',
    periodFrom: '2026-10-15',
    periodTo: '2026-10-17',
    poNumber: '52453465',
    billTo: {
      name: "Jurys Inn / Leonardo Hotels UK & Ire - St Paul's (M&E)",
      contact: 'Ajit Singh',
      emails: ['ajit_singh@leonardohotels.com'],
      address: '',
      venue: "Leonardo Hotel St Paul's",
      venueAddress: 'Leonardo Hotel St Pauls, 10 Godliman Street, London EC4V 5AJ',
      format: 'aggregated',
      dateLabel: 'Date',
    },
  },
  l3255,
);

// #3242 Taster London: named, weekly rows with no clock times.
const wk = (name: string, role: string, h: number, rate: number) =>
  shift('2026-10-12', role, null, null, 0, h, rate, { staffName: name });
const l3242: InvoiceLineData[] = [
  wk('Afolawe Mobolaji', 'Staff', 9.82, 17.77),
  wk('Emily Luxford', 'Shift Leader', 27.07, 19.52),
  wk('Suleyman Can Korkut', 'Shift Leader', 26.98, 19.52),
];
const I3242 = invoice(
  {
    number: 3242,
    invoiceDate: '2026-10-19',
    dueDate: '2026-10-26',
    periodFrom: '2026-10-12',
    periodTo: '2026-10-18',
    poNumber: 'SBX-London-W42-2026',
    billTo: {
      name: 'Taster UK SBX Limited (London)',
      contact: 'Boyd Baptist Wahr',
      emails: ['boyd@taster.com'],
      venue: 'Spud Bros Express, Oxford Circus',
      venueAddress: 'London, 4 Princes St, London W1B 2LE',
      format: 'named',
      dateLabel: 'W/C Date',
    },
  },
  l3242,
);

// #3253 The Hellenic Centre: aggregated, no PO, to-the-minute (4h03 = 4.05).
const l3253 = [
  shift('2026-10-13', 'Cloakroom Staff', '17:00', '21:30', 0, 4.5, 21.5),
  { ...shift('2026-10-17', 'Cloakroom Staff', '17:00', '21:03', 0, 4.05, 21.5), amount: '87.08' },
];
const I3253 = invoice(
  {
    number: 3253,
    invoiceDate: '2026-10-20',
    dueDate: '2026-10-27',
    periodFrom: '2026-10-13',
    periodTo: '2026-10-17',
    billTo: {
      name: 'The Hellenic Centre',
      contact: 'Anna Middleton',
      emails: ['administration@helleniccentre.org'],
      address: '16-18 Paddington St, London W1U 5AS',
      format: 'aggregated',
    },
  },
  l3253,
);

describe('timesheet invoice words (ADR-0210)', () => {
  it('#3253: aggregated, no staff names, no PO row, to-the-minute hours', () => {
    expect(timesheetColumns(I3253)).toEqual([
      'DATE',
      'ROLE',
      'START',
      'END',
      'BREAK',
      'NO. OF STAFF',
      'HOURS',
      'RATE',
      'TOTAL',
    ]);
    expect(timesheetRows(I3253)).toEqual([
      ['13/10/2026', 'Cloakroom Staff', '17:00', '21:30', '-', '1', '4.50', '£21.50', '£96.75'],
      ['17/10/2026', 'Cloakroom Staff', '17:00', '21:03', '-', '1', '4.05', '£21.50', '£87.08'],
    ]);
    expect(timesheetDetails(I3253).map(([k]) => k)).not.toContain('PO Number:');
    expect(timesheetTotalsRow(I3253)).toEqual([
      '',
      '',
      '',
      '',
      '',
      'Totals',
      '8.55',
      '',
      '£183.83',
    ]);
    expect(I3253).toMatchObject({ vat: '36.77', total: '220.60' });
  });

  it('#3242: named weekly rows print "-" for Start, End and Break; the date header is the client’s', () => {
    expect(timesheetColumns(I3242)[0]).toBe('W/C DATE');
    expect(timesheetRows(I3242)[1]).toEqual([
      '12/10/2026',
      'Emily Luxford',
      'Shift Leader',
      '-',
      '-',
      '-',
      '27.07',
      '£19.52',
      '£528.41',
    ]);
    expect(timesheetRows(I3242)[2]?.[8]).toBe('£526.65');
    expect(timesheetDetails(I3242)).toContainEqual(['PO Number:', 'SBX-London-W42-2026']);
    expect(timesheetDetails(I3242)).toContainEqual(['Due Date:', '26/10/2026']);
  });

  it('#3255: 28 lines, 186.00 h, and the printed lines add up to the subtotal exactly', () => {
    expect(l3255).toHaveLength(28);
    expect(timesheetTotalHours(l3255)).toBe(186);
    const printed = timesheetRows(I3255).map((r) => Number(r[8]!.replace(/[£,]/g, '')));
    expect(pence(printed.reduce((a, b) => a + b, 0))).toBe(Number(I3255.net));
    expect(timesheetTotalsRow(I3255)[8]).toBe(
      `£${Number(I3255.net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
    );
    // overnight wine shift, UK clock; sorted by date, then as stored
    expect(timesheetRows(I3255)[0]).toEqual([
      '15/10/2026',
      'Food Waiting Staff M&E MINUS 1',
      '07:00',
      '16:00',
      '30 mins',
      '1',
      '8.50',
      '£18.98',
      '£161.33',
    ]);
    expect(timesheetRows(I3255).at(-1)?.[0]).toBe('17/10/2026');
    expect(I3255.billTo.dateLabel).toBe('Date');
  });

  it('prints an expense line by description x quantity x unit price, and a staff count multiplies', () => {
    const train: InvoiceLineData = {
      date: '2026-10-13',
      staffName: '',
      employeeId: null,
      role: 'Train Fare',
      startsAt: null,
      endsAt: null,
      breakMin: 0,
      payableMin: 0,
      rate: '18.90',
      amount: '37.80',
      kind: 'custom',
      quantity: '2.00',
    };
    const crew = shift('2026-10-13', 'Chef', '08:00', '12:00', 0, 4, 20, { staffCount: 3 });
    const d = invoice({ billTo: { ...I3253.billTo, format: 'aggregated' } }, [crew, train]);
    expect(timesheetRows(d)).toEqual([
      ['13/10/2026', 'Chef', '08:00', '12:00', '-', '3', '4.00', '£20.00', '£240.00'],
      ['13/10/2026', 'Train Fare', '-', '-', '-', '-', '2.00', '£18.90', '£37.80'],
    ]);
    expect(timesheetTotalHours([crew, train])).toBe(12);
    const named = invoice({ billTo: { ...I3242.billTo } }, [train]);
    expect(timesheetRows(named)[0]).toEqual([
      '13/10/2026',
      '',
      'Train Fare',
      '-',
      '-',
      '-',
      '2.00',
      '£18.90',
      '£37.80',
    ]);
  });

  it('names the file after the old tool’s pattern', () => {
    expect(timesheetInvoiceFileName(I3255, 'pdf')).toBe(
      'Jurys Inn Leonardo Hotels UK Ire St Paul s M E - Inv 3255 - w-c 15-10-2026 - 52453465.pdf',
    );
    expect(timesheetInvoiceFileName(I3253, 'xlsx')).toBe(
      'The Hellenic Centre - Inv 3253 - w-c 13-10-2026.xlsx',
    );
  });
});

describe('rendered timesheet invoice', () => {
  it('draws an A4 PDF for each layout', { timeout: 30_000 }, async () => {
    for (const d of [I3255, I3242, I3253]) {
      const pdf = await renderTimesheetInvoicePdf(d);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(countPdfPages(pdf)).toBeGreaterThanOrEqual(1);
      for (const size of pdfPageSizes(pdf)) expect(size.width).toBeCloseTo(A4_POINTS.width, 1);
    }
    const many = invoice(
      I3255,
      Array.from({ length: 70 }, () => l3255[0]!),
    );
    expect(countPdfPages(await renderTimesheetInvoicePdf(many))).toBeGreaterThan(1);
  });

  it('writes the same figures into a one-sheet workbook', { timeout: 30_000 }, async () => {
    const bytes = await renderInvoiceXlsx(I3242);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Invoice 3242');
    expect(ws.getCell('A1').value).toBe('THE HOSPITALITY COMPANY (London) Ltd');
    const rows: string[][] = [];
    ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ''))));
    const flat = rows.map((r) => r.join('|'));
    expect(flat).toContain('W/C DATE|STAFF NAME|ROLE|START|END|BREAK|HOURS|RATE|TOTAL');
    expect(flat).toContain('12/10/2026|Emily Luxford|Shift Leader|-|-|-|27.07|£19.52|£528.41');
    expect(
      flat.some(
        (r) =>
          r.includes('TOTAL DUE:') &&
          r.includes(
            `£${Number(I3242.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
          ),
      ),
    ).toBe(true);
    expect(flat.some((r) => r.includes('Payable Within 7 Days from Date of Invoice'))).toBe(true);
  });
});
