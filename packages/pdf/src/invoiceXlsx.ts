/**
 * The same timesheet invoice (ADR-0210) as a one-sheet workbook, "Invoice
 * <n>", for the client's accounts team — the PDF's layout and wording,
 * static values (no formulas), written by `exceljs`.
 *
 *   A1-A3   company name · registrations · e-mail and web
 *   INVOICE TO / INVOICE DETAILS side by side, then the table, Totals,
 *   Total Hours / Subtotal / VAT / TOTAL DUE, Payment Details and the
 *   late-payment paragraph.
 */

import ExcelJS from 'exceljs';
import { invoiceMoney, invoiceTerms, invoiceVatLabel } from './invoice.ts';
import type { InvoiceDocumentData } from './invoice.ts';
import {
  TIMESHEET_RIGHT,
  timesheetBillTo,
  timesheetColumns,
  timesheetDetails,
  timesheetHours,
  timesheetRows,
  timesheetTotalHours,
  timesheetTotalsRow,
} from './timesheetInvoice.ts';

const WIDTHS = [14, 30, 30, 9, 9, 12, 10, 11, 13];
const BAND = 'FFEEEEEE';

export async function renderInvoiceXlsx(data: InvoiceDocumentData): Promise<Uint8Array> {
  const co = data.seller.company ?? {};
  const bank = data.seller.bank ?? {};
  const wb = new ExcelJS.Workbook();
  wb.creator = co.name ?? 'The Hospitality Company';
  const ws = wb.addWorksheet(`Invoice ${data.number}`);
  ws.columns = WIDTHS.map((width) => ({ width }));
  const bold = { bold: true };

  const put = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold: opts.bold, size: opts.size };
    return row;
  };

  put(co.name ?? '', { bold: true, size: 12 });
  put(
    [
      co.company_reg ? `Company Reg: ${co.company_reg}` : '',
      co.vat_reg ? `VAT Reg: ${co.vat_reg}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  put([co.email, co.website].filter(Boolean).join(' · '));
  ws.getCell('I1').value = 'INVOICE';
  ws.getCell('I1').font = { bold: true, size: 18 };
  ws.getCell('I1').alignment = { horizontal: 'right' };
  ws.addRow([]);

  // Invoice to (A:C) beside Invoice details (F:I).
  const bill = timesheetBillTo(data);
  const left = [bill.name, ...bill.lines];
  const right = timesheetDetails(data);
  const head = ws.addRow(['INVOICE TO', '', '', '', '', 'INVOICE DETAILS']);
  head.getCell(1).font = bold;
  head.getCell(6).font = bold;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const r = ws.addRow([
      left[i] ?? '',
      '',
      '',
      '',
      '',
      right[i]?.[0] ?? '',
      '',
      right[i]?.[1] ?? '',
    ]);
    if (i === 0) r.getCell(1).font = bold;
  }
  ws.addRow([]);

  const header = ws.addRow([...timesheetColumns(data)]);
  header.eachCell((c, col) => {
    c.font = bold;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    if (TIMESHEET_RIGHT.has(col - 1)) c.alignment = { horizontal: 'right' };
  });
  for (const cells of timesheetRows(data)) {
    const r = ws.addRow(cells);
    r.eachCell({ includeEmpty: true }, (c, col) => {
      if (TIMESHEET_RIGHT.has(col - 1)) c.alignment = { horizontal: 'right' };
      c.alignment = { ...c.alignment, vertical: 'top', wrapText: true };
    });
  }
  const totals = ws.addRow(timesheetTotalsRow(data));
  totals.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = bold;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    if (TIMESHEET_RIGHT.has(col - 1)) c.alignment = { horizontal: 'right' };
  });
  ws.addRow([]);

  const sum = (k: string, v: string, strong = false) => {
    const r = ws.addRow(['', '', '', '', '', '', k, '', v]);
    r.getCell(7).font = { bold: strong };
    r.getCell(9).font = { bold: strong };
    r.getCell(9).alignment = { horizontal: 'right' };
  };
  sum('Total Hours:', timesheetHours(timesheetTotalHours(data.lines)));
  sum('Subtotal:', invoiceMoney(data.net));
  sum(`${invoiceVatLabel(data.vatRate)}:`, invoiceMoney(data.vat));
  sum('TOTAL DUE:', invoiceMoney(data.total), true);
  ws.addRow([]);

  put('Payment Details', { bold: true });
  for (const [k, v] of [
    ['Account Name:', bank.account_name ?? ''],
    ['Bank:', bank.bank ?? ''],
    ['Account Number:', bank.account_number ?? ''],
    ['Sort Code:', bank.sort_code ?? ''],
    ['Payment Terms:', invoiceTerms(data.termsDays)],
  ] as const) {
    ws.addRow([k, v]);
  }
  ws.addRow([]);

  if (data.seller.late_payment_note) {
    const r = ws.addRow([data.seller.late_payment_note]);
    ws.mergeCells(r.number, 1, r.number, 9);
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).font = { size: 8 };
    r.height = 36;
  }
  ws.addRow([]);
  const thanks = ws.addRow(['Thank you for your business']);
  ws.mergeCells(thanks.number, 1, thanks.number, 9);
  thanks.getCell(1).alignment = { horizontal: 'center' };

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
