import { createAdminClient } from '@thc/db/admin';
import {
  contentDisposition,
  documentsDb,
  isUuid,
  supabaseConfigured,
} from '../../documents/_lib/generate';

/**
 * GET /api/invoices/:invoiceId — the issued invoice PDF (ADR-0175), exactly
 * as it was emailed: the stored file, never a fresh drawing, so the copy the
 * office downloads and the copy the client holds are the same bytes.
 *
 * `invoice_file()` runs as the caller and is finance-gated (admin with
 * finance; a scheduler is refused), so the session decides who may read; the
 * file itself comes out of the private `timesheets` bucket with the service
 * key. Nothing is written, so no Sec-Fetch-Site check is needed.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  if (!isUuid(invoiceId)) return new Response('Unknown invoice.', { status: 400 });
  if (!supabaseConfigured())
    return new Response('This environment has no Supabase project.', { status: 503 });

  // DocumentRpc names only the document functions; this route calls one more.
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
  const row = (Array.isArray(data) ? data[0] : data) as
    { storage_path: string | null; file_name: string | null; number: number } | undefined;
  if (!row) return new Response('That invoice does not exist.', { status: 404 });
  if (!row.storage_path)
    return new Response(`Invoice ${row.number} is still being drawn; try again in a few minutes.`, {
      status: 409,
    });

  const file = await createAdminClient().storage.from('timesheets').download(row.storage_path);
  if (file.error || !file.data) {
    console.error('[invoices] download failed', { invoiceId, detail: file.error?.message });
    return new Response('The invoice file could not be read.', { status: 500 });
  }
  return new Response(new Uint8Array(await file.data.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(row.file_name ?? `Invoice ${row.number}.pdf`),
      'Cache-Control': 'no-store',
    },
  });
}
