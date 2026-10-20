/**
 * THC's invoice (ADR-0175) — the words and figures, decided here and drawn
 * by `InvoiceDocument.tsx`, laid out after THC's own invoice (20.10.2026):
 * the company block, Invoice to / Invoice details, one line per shift
 * (Date · Staff name · Role · Start · End · Break · Hours · Rate · Total),
 * Total hours / Subtotal / VAT / Total due, Payment details and the
 * late-payment wording.
 *
 * Nothing is priced here. The lines, net, VAT and total arrive as the
 * database issued them (`invoice_document_data`, 20261022100000); this file
 * only writes them down — in UK dates and 24-hour UK times, like every
 * document the product prints (§1.8).
 */

import { UK_ZONE } from './format.ts';

export interface InvoiceLineData {
  date: string;
  staffName: string;
  employeeId: number | null;
  role: string;
  startsAt: string;
  endsAt: string;
  breakMin: number;
  payableMin: number;
  rate: number | string;
  amount: number | string;
  kind: string;
}

export interface InvoiceDocumentData {
  id: string;
  number: number;
  invoiceDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  poNumber: string | null;
  payableMin: number;
  net: number | string;
  vatRate: number | string;
  vat: number | string;
  total: number | string;
  termsDays: number;
  billTo: {
    name: string;
    contact?: string | null;
    emails?: string[] | null;
    address?: string | null;
  };
  seller: {
    company?: {
      name?: string;
      company_reg?: string;
      vat_reg?: string;
      email?: string;
      website?: string;
    };
    bank?: { account_name?: string; bank?: string; account_number?: string; sort_code?: string };
    late_payment_note?: string;
  };
  recipients: string[];
  events: { id: string; title: string; date: string; venue?: string | null }[];
  lines: InvoiceLineData[];
}

export const INVOICE_COLUMNS = [
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

const num = (v: number | string | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : typeof v === 'number' ? v : Number(v);

/** "£2,002.39". */
export function invoiceMoney(v: number | string | null | undefined): string {
  return `£${num(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "19/10/2026" from an ISO date. */
export function invoiceDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "16:30", UK wall clock, 24-hour (§1.8: documents stay 24-hour). */
export function invoiceTime(instant: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** "30 mins", "1 hr 15 mins", or "—" when nothing was deducted. */
export function invoiceBreak(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mins = m ? `${m} min${m === 1 ? '' : 's'}` : '';
  if (!h) return mins;
  return `${h} hr${h === 1 ? '' : 's'}${mins ? ` ${mins}` : ''}`;
}

/** "9.00". */
export function invoiceHours(minutes: number): string {
  return (num(minutes) / 60).toFixed(2);
}

/** "14/10/2026" or "14/10/2026 to 17/10/2026". */
export function invoiceEventDates(from: string, to: string): string {
  return from === to ? invoiceDate(from) : `${invoiceDate(from)} to ${invoiceDate(to)}`;
}

/** "VAT (20%)". */
export function invoiceVatLabel(rate: number | string): string {
  const r = num(rate);
  return `VAT (${Number.isInteger(r) ? r : r.toFixed(2)}%)`;
}

/** "Payable Within 7 Days from Date of Invoice" — THC's own wording. */
export function invoiceTerms(days: number): string {
  return days > 0
    ? `Payable Within ${days} Day${days === 1 ? '' : 's'} from Date of Invoice`
    : 'Payable on Receipt';
}

/** "Invoice 4000 – Mandarin Oriental Hyde Park – PO 714981.pdf". */
export function invoiceFileName(
  data: Pick<InvoiceDocumentData, 'number' | 'billTo' | 'poNumber'>,
): string {
  const safe = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  const po = data.poNumber ? ` – PO ${safe(data.poNumber)}` : '';
  return `Invoice ${data.number} – ${safe(data.billTo.name)}${po}.pdf`;
}

/** One printed row per shift, in the order the database issued them. */
export function invoiceRows(lines: readonly InvoiceLineData[]): string[][] {
  return lines.map((l) => [
    invoiceDate(l.date),
    l.staffName,
    l.role,
    invoiceTime(l.startsAt),
    invoiceTime(l.endsAt),
    invoiceBreak(l.breakMin),
    invoiceHours(l.payableMin),
    invoiceMoney(l.rate),
    invoiceMoney(l.amount),
  ]);
}
