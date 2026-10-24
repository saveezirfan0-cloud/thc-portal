import { textCell, toCsv } from '@thc/pdf/csv';
import { hoursFromMin, ukDate, ukStamp } from './format';
import { FORMAT_LABEL, SOURCE_LABEL, STATUS_LABEL, XERO_LABEL } from './view-model';
import type { InvoiceListRow } from './types';

// ---------------------------------------------------------------------------
// CSV (the Back Office convention: packages/pdf csv.ts — BOM, CRLF, defused text)
// ---------------------------------------------------------------------------

export const INVOICE_CSV_COLUMNS = [
  'Invoice',
  'Date',
  'Client',
  'Venue',
  'PO',
  'Source',
  'Format',
  'Hours',
  'Subtotal',
  'VAT',
  'Amount due',
  'Status',
  'Last sent',
  'Xero',
  'Xero invoice id',
] as const;

const money2 = (n: number) => n.toFixed(2);

export function invoicesCsv(rows: readonly InvoiceListRow[]): string {
  return toCsv(
    INVOICE_CSV_COLUMNS,
    rows.map((r) => [
      String(r.number),
      ukDate(r.invoiceDate),
      textCell(r.clientName),
      textCell(r.venue),
      textCell(r.poNumber),
      SOURCE_LABEL[r.source],
      FORMAT_LABEL[r.format],
      hoursFromMin(r.payableMin).toFixed(2),
      money2(r.net),
      money2(r.vat),
      money2(r.total),
      STATUS_LABEL[r.status],
      r.lastSentAt ? ukStamp(r.lastSentAt) : '',
      r.xero ? XERO_LABEL[r.xero] : '',
      textCell(r.xeroInvoiceId),
    ]),
  );
}

export function csvFileName(today: string): string {
  return `THC invoices ${today}.csv`;
}
