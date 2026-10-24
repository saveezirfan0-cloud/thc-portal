import { createAdminClient } from '@thc/db/admin';
import {
  contentDisposition,
  documentsDb,
  isUuid,
  supabaseConfigured,
} from '../../../documents/_lib/generate';

/**
 * GET /api/invoices/:invoiceId/excel — the timesheet invoice's workbook
 * (ADR-0210), exactly as drawn and attached to the email: the stored file.
 *
 * Gated like the PDF route: `invoice_file()` runs as the caller and is
 * finance-only, so the session decides who may read; the workbook's path is
 * then read from `invoices.attachments -> 'excel'` and the file comes out of
 * the private `timesheets` bucket with the service key. Nothing is written.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  if (!isUuid(invoiceId)) return new Response('Unknown invoice.', { status: 400 });
  if (!supabaseConfigured())
    return new Response('This environment has no Supabase project.', { status: 503 });

  const db = (await documentsDb()) as unknown as {
    rpc(
      fn: 'invoice_file',
      args: { p_invoice: string },
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await db.rpc('invoice_file', { p_invoice: invoiceId });
  if (error) {
    if (/not_permitted|admins_only/.test(error.message))
      return new Response('Only the finance office can download invoices.', { status: 403 });
    console.error('[invoices] invoice_file failed', { invoiceId, detail: error.message });
    return new Response('The invoice could not be read.', { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { number: number } | undefined;
  if (!row) return new Response('That invoice does not exist.', { status: 404 });

  const admin = createAdminClient() as unknown as {
    from(table: string): {
      select(cols: string): {
        eq(
          col: string,
          v: string,
        ): {
          maybeSingle(): PromiseLike<{
            data: { attachments: unknown } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    storage: ReturnType<typeof createAdminClient>['storage'];
  };
  const found = await admin
    .from('invoices')
    .select('attachments')
    .eq('id', invoiceId)
    .maybeSingle();
  if (found.error) {
    console.error('[invoices] attachments read failed', { invoiceId, detail: found.error.message });
    return new Response('The invoice could not be read.', { status: 500 });
  }
  const attachments = found.data?.attachments as
    { excel?: { path?: string; name?: string } } | unknown[] | null | undefined;
  const excel = attachments && !Array.isArray(attachments) ? attachments.excel : undefined;
  if (!excel?.path)
    return new Response(`Invoice ${row.number} has no Excel file.`, { status: 404 });

  const file = await admin.storage.from('timesheets').download(excel.path);
  if (file.error || !file.data) {
    console.error('[invoices] excel download failed', { invoiceId, detail: file.error?.message });
    return new Response('The invoice file could not be read.', { status: 500 });
  }
  return new Response(new Uint8Array(await file.data.arrayBuffer()), {
    headers: {
      'Content-Type': XLSX,
      'Content-Disposition': contentDisposition(excel.name ?? `Invoice ${row.number}.xlsx`),
      'Cache-Control': 'no-store',
    },
  });
}
