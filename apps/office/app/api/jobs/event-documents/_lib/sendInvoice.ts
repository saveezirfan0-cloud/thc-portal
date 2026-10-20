import { invoiceFileName, renderInvoicePdf, renderSignInLogPdf, signInLogFileName } from '@thc/pdf';
import type { InvoiceDocumentData } from '@thc/pdf';
import type { DocumentRpc } from '../../../documents/_lib/generate';

/**
 * Draw, store, record and queue one issued invoice (ADR-0176): the invoice
 * PDF and the sign-in / sign-out log that supports it, side by side in the
 * private `timesheets` bucket under `invoices/<number>/<stamp>/` — a new
 * folder every attempt, nothing overwritten — then the INV1 email.
 *
 * The log is drawn from the invoice's own lines (actual sign-in and
 * sign-out, break, hours charged, as issued), so it agrees with the
 * invoice line for line (THC, 20.10.2026). The allocation-style timesheet
 * is the 16:00 day-before email (D1), not this.
 */

interface InvoiceRpc extends DocumentRpc {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface StorageWriter {
  upload(path: string, pdf: Buffer): Promise<void>;
}

export async function sendInvoice(
  db: InvoiceRpc,
  storage: StorageWriter,
  invoiceId: string,
  now: Date = new Date(),
): Promise<{ number: number; queued: boolean }> {
  // Counted before any work: a run killed mid-draw still counts (ADR-0176).
  const begun = await db.rpc('invoice_begin', { p_invoice: invoiceId, p_now: now.toISOString() });
  if (begun.error) throw new Error(`invoice_begin: ${begun.error.message}`);

  const read = await db.rpc('invoice_document_data', { p_invoice: invoiceId });
  if (read.error) throw new Error(`invoice_document_data: ${read.error.message}`);
  const doc = read.data as InvoiceDocumentData;

  const base = `invoices/${doc.number}/${now.toISOString().replace(/[:.]/g, '-')}`;
  const fileName = invoiceFileName(doc);
  const invoicePath = `${base}/invoice.pdf`;
  await storage.upload(invoicePath, await renderInvoicePdf(doc));

  const logPath = `${base}/sign-in-log.pdf`;
  await storage.upload(logPath, await renderSignInLogPdf(doc));

  const attachments = [
    { bucket: 'timesheets' as const, path: invoicePath, filename: fileName },
    {
      bucket: 'timesheets' as const,
      path: logPath,
      filename: signInLogFileName(fileName),
      role: 'timesheet' as const,
    },
  ];

  const recorded = await db.rpc('invoice_record_files', {
    p_invoice: invoiceId,
    p_storage_path: invoicePath,
    p_file_name: fileName,
    p_attachments: attachments,
  });
  if (recorded.error) throw new Error(`invoice_record_files: ${recorded.error.message}`);

  const queued = await db.rpc('queue_invoice_email', { p_invoice: invoiceId });
  if (queued.error) throw new Error(`queue_invoice_email: ${queued.error.message}`);
  return {
    number: doc.number,
    queued: (queued.data as { queued?: boolean } | null)?.queued === true,
  };
}
