import type { XeroInvoicePayload, XeroLineItem } from './client';
import type { XeroSettings } from './settings';

/**
 * Our invoice -> Xero's (ADR-0210 §6, ADR-0211). Pure.
 *
 * `invoice_document_data()` is the one source: the lines, net, VAT and total
 * exactly as issued. Nothing is priced here. Each Xero line carries OUR stored
 * line amount, so Xero's net equals ours to the penny; Quantity x UnitAmount
 * is only shown when it reproduces that amount exactly, otherwise the line is
 * 1 x amount with the working in the description. VAT is Xero's own sum
 * unless it would differ from ours (we round once on the subtotal, Xero
 * rounds per line), in which case the per-line TaxAmounts are set so they add
 * up to our VAT.
 */

export interface DocLine {
  date: string;
  staffName?: string | null;
  role?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  breakMin?: number | null;
  payableMin?: number | null;
  rate: number | string;
  amount: number | string;
  kind: string;
  hours?: number | string | null;
  staffCount?: number | null;
  quantity?: number | string | null;
}

export interface DocData {
  number: number;
  invoiceDate: string;
  dueDate: string;
  poNumber?: string | null;
  vatRate: number | string;
  vat: number | string;
  net: number | string;
  total: number | string;
  billTo: { name: string; emails?: string[] | null; format?: 'named' | 'aggregated' };
  lines: DocLine[];
}

const cents = (v: number | string): number => Math.round(Number(v) * 100 + 1e-7);
const money = (c: number): number => c / 100;

/** Quantity x unit price in pence, rounding half up on the exact product. */
function productCents(quantity: number, rate: number): number {
  const q4 = Math.round(quantity * 1e4);
  return Math.round((q4 * cents(rate)) / 1e4);
}

const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function hhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ukTime.format(d);
}

function ukDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day;
}

const trimNumber = (n: number): string => String(Number(n.toFixed(4)));

export function describeLine(line: DocLine, named: boolean, hours: number | null): string {
  const parts: string[] = [ukDate(line.date)];
  const role = (line.role ?? '').trim();
  if (line.kind === 'custom') {
    return [ukDate(line.date), role].filter(Boolean).join(' · ').slice(0, 4000);
  }
  if (line.kind === 'overrun') parts.push(`Overrun – ${role}`);
  else if (line.kind === 'cancelled_on_day') parts.push(`${role} (cancelled on the day)`);
  else if (role) parts.push(role);
  // Aggregated clients are never given staff names in Xero.
  if (named && line.staffName?.trim()) parts.push(line.staffName.trim());
  const from = hhmm(line.startsAt);
  const to = hhmm(line.endsAt);
  if (from && to) parts.push(`${from}–${to}`);
  if (line.breakMin) parts.push(`break ${line.breakMin} min`);
  if (hours !== null) parts.push(`${trimNumber(hours)} h`);
  if (!named && (line.staffCount ?? 1) > 1) parts.push(`${line.staffCount} staff`);
  return parts.join(' · ').slice(0, 4000);
}

function quantityOf(line: DocLine): { quantity: number; hours: number | null } {
  if (line.kind === 'custom') return { quantity: Number(line.quantity ?? 1), hours: null };
  const people = line.staffCount && line.staffCount > 0 ? line.staffCount : 1;
  const perPerson =
    line.hours !== null && line.hours !== undefined && line.hours !== ''
      ? Number(line.hours)
      : (line.payableMin ?? 0) / 60;
  return { quantity: Math.round(perPerson * people * 1e4) / 1e4, hours: perPerson };
}

export function mapInvoice(
  doc: DocData,
  contactId: string,
  settings: XeroSettings,
): XeroInvoicePayload {
  const named = (doc.billTo.format ?? 'named') === 'named';
  const vatRate = Number(doc.vatRate);
  const taxType = vatRate === 0 ? 'ZERORATEDOUTPUT' : settings.tax_type;

  const lines: XeroLineItem[] = doc.lines.map((line) => {
    const amountC = cents(line.amount);
    const rate = Number(line.rate);
    const { quantity, hours } = quantityOf(line);
    const exact = quantity > 0 && productCents(quantity, rate) === amountC;
    const description = describeLine(line, named, hours);
    return exact
      ? {
          Description: description,
          Quantity: quantity,
          UnitAmount: money(cents(rate)),
          AccountCode: settings.sales_account_code,
          TaxType: taxType,
          LineAmount: money(amountC),
        }
      : {
          Description: `${description} (${trimNumber(quantity)} × £${rate.toFixed(2)})`.slice(
            0,
            4000,
          ),
          Quantity: 1,
          UnitAmount: money(amountC),
          AccountCode: settings.sales_account_code,
          TaxType: taxType,
          LineAmount: money(amountC),
        };
  });

  // VAT: Xero rounds per line; ours is round(subtotal x rate, 2). Where those
  // differ, spread OUR vat over the lines by running totals so they add up.
  const ourVat = cents(doc.vat);
  const naive = lines.reduce((s, l) => s + Math.round((cents(l.LineAmount) * vatRate) / 100), 0);
  if (naive !== ourVat && vatRate !== 0 && lines.length > 0) {
    let running = 0;
    let given = 0;
    const netC = lines.reduce((s, l) => s + cents(l.LineAmount), 0);
    for (const line of lines) {
      running += cents(line.LineAmount);
      const target = netC === 0 ? 0 : Math.round((running * ourVat) / netC);
      line.TaxAmount = money(target - given);
      given = target;
    }
  }

  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    InvoiceNumber: String(doc.number),
    ...(doc.poNumber?.trim() ? { Reference: doc.poNumber.trim().slice(0, 255) } : {}),
    Date: doc.invoiceDate.slice(0, 10),
    DueDate: doc.dueDate.slice(0, 10),
    CurrencyCode: 'GBP',
    LineAmountTypes: 'Exclusive',
    Status: settings.invoice_status,
    LineItems: lines,
  };
}

/** The Idempotency-Key: the invoice number, plus a payload digest (see ADR-0211). */
export function idempotencyKey(number: number, digest: string): string {
  return `thc-invoice-${number}-${digest}`.slice(0, 128);
}
