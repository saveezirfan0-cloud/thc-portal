/**
 * The two functions another bot owns, imported in ONE file so a rename on
 * their side is a one-line change here.
 *
 *  · `runExtraction(jobId)` — apps/office/app/invoices/_lib/extract: service
 *    role; takes a job in 'uploaded' | 'error' to 'extracting', then to
 *    'reviewing' (or 'error'), inserting timesheet_shifts.
 *  · `drawTimesheetInvoice(invoiceId)` — apps/office/app/invoices/_lib/draw:
 *    draws the PDF/Excel for an issued invoice ('drawing' → 'generated').
 */
import { runExtraction as extract } from '../../_lib/extract';
import { drawTimesheetInvoice as draw } from '../../_lib/draw';

export type DrawResult = { ok: true } | { ok: false; error: string };

export function runExtraction(jobId: string): Promise<void> {
  return extract(jobId);
}

export function drawInvoice(invoiceId: string): Promise<DrawResult> {
  return draw(invoiceId);
}
