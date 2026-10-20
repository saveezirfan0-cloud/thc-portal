import { invoiceFileName, renderInvoicePdf } from '@thc/pdf';
import type { InvoiceDocumentData } from '@thc/pdf';
import { drawSheet } from '../../../documents/_lib/generate';
import type { DocumentRpc } from '../../../documents/_lib/generate';

/**
 * Draw, store, record and queue one issued invoice (ADR-0175): the invoice
 * PDF and the completed timesheet of each event on it, side by side in the
 * private `timesheets` bucket under `invoices/<number>/<stamp>/` — a new
 * folder every attempt, nothing overwritten — then the INV1 email.
 *
 * The timesheets are drawn fresh from `event_document_data`, exactly as the
 * D2 email draws them, but not recorded as event documents: the client's
 * timesheet history stays the D2 emails'. An event cancelled on the day has
 * no timesheet (§3.3) and is invoiced without one.
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
  const read = await db.rpc('invoice_document_data', { p_invoice: invoiceId });
  if (read.error) throw new Error(`invoice_document_data: ${read.error.message}`);
  const doc = read.data as InvoiceDocumentData;

  const base = `invoices/${doc.number}/${now.toISOString().replace(/[:.]/g, '-')}`;
  const fileName = invoiceFileName(doc);
  const invoicePath = `${base}/invoice.pdf`;
  await storage.upload(invoicePath, await renderInvoicePdf(doc));

  const attachments: {
    bucket: 'timesheets';
    path: string;
    filename: string;
    role?: 'timesheet';
  }[] = [{ bucket: 'timesheets', path: invoicePath, filename: fileName }];
  for (const event of doc.events) {
    const sheet = await drawSheet(db, event.id, 'signout');
    if (!sheet.ok) {
      if (sheet.status === 409) continue; // cancelled: no timesheet (§3.3)
      throw new Error(`timesheet for ${event.id}: ${sheet.message}`);
    }
    const path = `${base}/timesheet-${event.id}.pdf`;
    await storage.upload(path, sheet.pdf);
    attachments.push({
      bucket: 'timesheets',
      path,
      filename: sheet.layout.fileName,
      role: 'timesheet',
    });
  }

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
