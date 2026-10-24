import { createAdminClient } from '@thc/db/admin';
import { renderInvoiceXlsx, renderTimesheetInvoicePdf, timesheetInvoiceFileName } from '@thc/pdf';
import type { InvoiceDocumentData } from '@thc/pdf';

/**
 * Draw one issued timesheet invoice (ADR-0210): the PDF and the Excel, both
 * stored in the private `timesheets` bucket under `invoices/<number>/`, then
 * recorded on the invoice with the original timesheet files beside them
 * (the office attaches those to the email), then `drawing | failed ->
 * generated`.
 *
 * Idempotent: the paths depend only on the number and the file names, so a
 * Re-draw after a failure overwrites the same objects. Any failure hands the
 * invoice back as `failed` with the reason (`invoice_release`) and the office
 * presses Re-draw. An invoice that is not open (already generated, sent,
 * void, or not a timesheet invoice) is refused untouched: `invoice_release`
 * would otherwise turn a generated invoice into a failed one.
 *
 * The caller has already decided who may do this (the Generate action checks
 * finance and write); this runs with the service role.
 */

export interface DrawDeps {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** The invoice row's status and timesheet job. */
  invoice(
    id: string,
  ): Promise<{ status: string; source: string; timesheet_job_id: string | null } | null>;
  /** The job's uploaded source files. */
  sourceFiles(jobId: string): Promise<{ storage_path: string; file_name: string }[]>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type DrawResult = { ok: true } | { ok: false; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function drawWith(deps: DrawDeps, invoiceId: string): Promise<DrawResult> {
  let row;
  try {
    row = await deps.invoice(invoiceId);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  if (!row) return { ok: false, error: 'invoice_not_found' };
  if (row.source !== 'timesheet') return { ok: false, error: 'invoice_not_timesheet' };
  if (row.status !== 'drawing' && row.status !== 'failed')
    return { ok: false, error: `invoice_not_open: ${row.status}` };

  try {
    const begun = await deps.rpc('invoice_begin', { p_invoice: invoiceId });
    if (begun.error) throw new Error(`invoice_begin: ${begun.error.message}`);

    const read = await deps.rpc('invoice_document_data', { p_invoice: invoiceId });
    if (read.error) throw new Error(`invoice_document_data: ${read.error.message}`);
    const doc = read.data as InvoiceDocumentData;
    if (doc.source !== 'timesheet') throw new Error('invoice_not_timesheet');

    const base = `invoices/${doc.number}`;
    const pdfName = timesheetInvoiceFileName(doc, 'pdf');
    const xlsxName = timesheetInvoiceFileName(doc, 'xlsx');
    const pdfPath = `${base}/${pdfName}`;
    const xlsxPath = `${base}/${xlsxName}`;
    await deps.upload(pdfPath, new Uint8Array(await renderTimesheetInvoicePdf(doc)), PDF);
    await deps.upload(xlsxPath, await renderInvoiceXlsx(doc), XLSX);

    const sources = row.timesheet_job_id ? await deps.sourceFiles(row.timesheet_job_id) : [];
    const recorded = await deps.rpc('invoice_record_files', {
      p_invoice: invoiceId,
      p_storage_path: pdfPath,
      p_file_name: pdfName,
      p_attachments: {
        excel: { path: xlsxPath, name: xlsxName },
        sources: sources.map((f) => ({ path: f.storage_path, name: f.file_name })),
      },
    });
    if (recorded.error) throw new Error(`invoice_record_files: ${recorded.error.message}`);

    const marked = await deps.rpc('invoice_mark_generated', { p_invoice: invoiceId });
    if (marked.error) throw new Error(`invoice_mark_generated: ${marked.error.message}`);
    return { ok: true };
  } catch (e) {
    const error = message(e);
    // Never a name, address or amount in the log: ids and reasons only.
    console.error('[invoices] draw failed', { invoiceId, detail: error });
    try {
      await deps.rpc('invoice_release', { p_invoice: invoiceId, p_error: error });
    } catch {
      /* the invoice stays drawing under its lease; the office can Re-draw */
    }
    return { ok: false, error };
  }
}

function adminDeps(): DrawDeps {
  const admin = createAdminClient();
  // The generated types predate ADR-0210's columns and table; name what is read.
  const db = admin as unknown as {
    rpc: DrawDeps['rpc'];
    from(table: string): {
      select(cols: string): {
        eq(
          col: string,
          v: string,
        ): {
          maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
        } & PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  return {
    rpc: (fn, args) => db.rpc(fn, args),
    async invoice(id) {
      const { data, error } = await db
        .from('invoices')
        .select('status, source, timesheet_job_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`invoices: ${error.message}`);
      return data as Awaited<ReturnType<DrawDeps['invoice']>>;
    },
    async sourceFiles(jobId) {
      const { data, error } = await (db
        .from('timesheet_files')
        .select('storage_path, file_name')
        .eq('job_id', jobId) as PromiseLike<{
        data: { storage_path: string; file_name: string }[] | null;
        error: { message: string } | null;
      }>);
      if (error) throw new Error(`timesheet_files: ${error.message}`);
      return data ?? [];
    },
    async upload(path, bytes, contentType) {
      const { error } = await admin.storage
        .from('timesheets')
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`upload ${path}: ${error.message}`);
    },
  };
}

export async function drawTimesheetInvoice(invoiceId: string): Promise<DrawResult> {
  return drawWith(adminDeps(), invoiceId);
}
