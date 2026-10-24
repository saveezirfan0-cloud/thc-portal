import type { DocData, DocLine } from '../map';

/**
 * The audit's sample invoice (docs/legacy-invoicing-audit.md §4.3 A): #3255,
 * Leonardo Hotel St Paul's M+E, role-aggregated, PO 52453465, every line at
 * £18.98/h, 28 lines, 186.00 h, subtotal £3,530.28, VAT £706.06, due £4,236.34.
 *
 * The audit's table lists the rows with their counts; its counts add up to 29
 * against "28 lines" and 186.00 h, so the Wine row is taken as x3 here to
 * agree with its totals. Amounts are recomputed per line (hours x staff x
 * rate, rounded to the penny) with integer arithmetic, independent of
 * map.ts, and the invoice totals are derived the way issue_timesheet_invoice
 * does: net = sum of printed lines, vat = round(net x 20%, 2).
 */
const RATE_C = 1898;
const rows: { date: string; role: string; hours: number; count: number }[] = [
  { date: '2026-10-17', role: 'Wine Waiting Staff M&E', hours: 7, count: 3 },
  { date: '2026-10-17', role: 'Food Waiting Staff M&E', hours: 4, count: 4 },
  { date: '2026-10-17', role: 'TEAM LEAD', hours: 4, count: 2 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E MINUS 1', hours: 8.5, count: 2 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E MINUS 2', hours: 7, count: 4 },
  { date: '2026-10-15', role: 'Cloakroom Staff M&E', hours: 8.5, count: 1 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E', hours: 10.5, count: 5 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E', hours: 5.5, count: 1 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E', hours: 4.5, count: 1 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E', hours: 9, count: 1 },
  { date: '2026-10-15', role: 'Food Waiting Staff M&E', hours: 4, count: 4 },
];

export const AUDIT_LINE_COUNT = rows.reduce((s, r) => s + r.count, 0); // 28
export const AUDIT_HOURS = rows.reduce((s, r) => s + r.hours * r.count, 0); // 186

function line(r: (typeof rows)[number]): DocLine {
  const cents = Math.round((Math.round(r.hours * 100) * r.count * RATE_C) / 100);
  return {
    date: r.date,
    staffName: '',
    role: r.role,
    startsAt: null,
    endsAt: null,
    breakMin: 0,
    payableMin: Math.round(r.hours * 60),
    rate: 18.98,
    amount: cents / 100,
    kind: 'timesheet',
    hours: r.hours,
    staffCount: r.count,
    quantity: null,
  };
}

export function auditInvoice(number = 3255): DocData {
  const lines = rows.map(line);
  const netC = lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  const vatC = Math.round(netC * 0.2);
  return {
    number,
    invoiceDate: '2026-10-20',
    dueDate: '2026-10-27',
    poNumber: '52453465',
    vatRate: 20,
    net: netC / 100,
    vat: vatC / 100,
    total: (netC + vatC) / 100,
    billTo: {
      name: "Jurys Inn & Leonardo Hotels UK & Ire St Paul's M & E",
      emails: ['ajit_singh@leonardohotels.com'],
      format: 'aggregated',
    },
    lines,
  };
}
