import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { countPdfPages, layoutSheet, photoFormat, renderSheetPdf } from '@thc/pdf';
import type { SheetEvent, SheetKind, SheetLayout, SheetPerson, SheetPhoto } from '@thc/pdf';

/**
 * Draw, and keep, one allocation sheet or sign-out timesheet — §11.3, §11.4.
 *
 * 1. `event_document_data()` as the signed-in manager: the header, the
 *    confirmed/worked line-up with role windows, settled finish times and
 *    hours worked. It refuses a cancelled event (§3.3) and anybody but the
 *    office. A removed worker arrives already anonymised with no photo
 *    (§1.7), so this file never holds a real name it must not print.
 * 2. The selfies, downloaded through the manager's own session (the
 *    `photos_admin_read` policy), shrunk by Storage's image transform where
 *    the project has it so a 60-name sheet stays attachable.
 * 3. `layoutSheet()` + `renderSheetPdf()` from packages/pdf.
 * 4. The PDF into the private `timesheets` bucket under a NEW path every
 *    time — a copy already issued is never overwritten (§1.7) — and a row
 *    in `event_documents` via `record_event_document()`.
 *
 * Step 4 needs SUPABASE_SERVICE_ROLE_KEY: the bucket is service-role only
 * (20260922183015). Without it a Download still works — the PDF comes back
 * unstored — but Send cannot, because the drain attaches from Storage.
 */

export type GenerateResult =
  | {
      ok: true;
      pdf: Buffer;
      layout: SheetLayout;
      pages: number;
      documentId: string | null;
      storagePath: string | null;
    }
  | { ok: false; status: number; message: string };

interface DocumentRpc {
  rpc(
    fn: 'event_document_data',
    args: { p_event: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: 'record_event_document',
    args: {
      p_event: string;
      p_kind: SheetKind;
      p_storage_path: string;
      p_file_name: string;
      p_rows: number;
      p_pages: number;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: 'queue_event_document_email',
    args: { p_document: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      download(
        path: string,
        options?: { transform?: { width: number; height: number; resize?: 'cover' } },
      ): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
}

export async function documentsDb(): Promise<DocumentRpc> {
  return createClient(await cookies()) as unknown as DocumentRpc;
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function parseKind(value: unknown): SheetKind | null {
  return value === 'allocation' || value === 'signout' ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The database's refusals, as HTTP. */
export function refusal(message: string): { status: number; message: string } {
  if (message.includes('admins_only'))
    return { status: 403, message: 'Only the office can produce timesheet documents.' };
  if (message.includes('event_cancelled'))
    return {
      status: 409,
      message: 'This event is cancelled, so no allocation sheet or timesheet is generated (§11.3).',
    };
  if (message.includes('event_not_found'))
    return { status: 404, message: 'That event does not exist.' };
  if (message.includes('client_has_no_contact_email'))
    return { status: 409, message: 'The client card has no contact email to send to (§9.7).' };
  return { status: 500, message };
}

interface DocumentData {
  event: SheetEvent & { contactEmails: string[] };
  rows: SheetPerson[];
}

/** Fetch photos a few at a time; any that fail simply leave the cell empty. */
async function loadPhotos(db: DocumentRpc, paths: string[]): Promise<Map<string, SheetPhoto>> {
  const photos = new Map<string, SheetPhoto>();
  const unique = [...new Set(paths)];
  const bucket = db.storage.from('photos');
  for (let i = 0; i < unique.length; i += 6) {
    await Promise.all(
      unique.slice(i, i + 6).map(async (path) => {
        try {
          let { data } = await bucket.download(path, {
            transform: { width: 96, height: 96, resize: 'cover' },
          });
          if (!data) ({ data } = await bucket.download(path));
          if (!data) return;
          const bytes = Buffer.from(await data.arrayBuffer());
          const format = photoFormat(bytes);
          if (format) photos.set(path, { data: bytes, format });
        } catch {
          // A missing selfie is an empty Photo cell, never a failed sheet.
        }
      }),
    );
  }
  return photos;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export async function generateDocument(
  eventId: string,
  kind: SheetKind,
  /**
   * required — Send: no stored copy, no email.
   * best-effort — Download: keep a copy when Storage allows it (so the
   * record of what was handed out is complete, and the Client Portal can
   * list it), but never withhold the PDF from the manager because of it.
   */
  store: 'required' | 'best-effort',
): Promise<GenerateResult> {
  const db = await documentsDb();
  const { data, error } = await db.rpc('event_document_data', { p_event: eventId });
  if (error) return { ok: false, ...refusal(error.message) };
  const doc = data as DocumentData;

  const layout = layoutSheet({ kind, event: doc.event, people: doc.rows });
  const photoPaths = layout.pages.flatMap((p) =>
    p.lines.flatMap((l) => (l.type === 'row' && l.row.photoPath ? [l.row.photoPath] : [])),
  );
  const photos = await loadPhotos(db, photoPaths);
  const pdf = await renderSheetPdf(layout, photos);
  const pages = countPdfPages(pdf);

  const unstored = { ok: true as const, pdf, layout, pages, documentId: null, storagePath: null };
  const fail = (status: number, message: string): GenerateResult =>
    store === 'required' ? { ok: false, status, message } : unstored;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(
      503,
      'The timesheets bucket needs SUPABASE_SERVICE_ROLE_KEY on this deployment, so the PDF cannot be stored or sent. Download still works.',
    );
  }

  const storagePath = `${eventId}/${kind}/${stamp(new Date())}.pdf`;
  try {
    const admin = createAdminClient();
    const upload = await admin.storage
      .from('timesheets')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (upload.error) return fail(502, `Storage refused the PDF: ${upload.error.message}`);
  } catch (cause) {
    return fail(502, `Storage is unreachable: ${(cause as Error).message}`);
  }

  const recorded = await db.rpc('record_event_document', {
    p_event: eventId,
    p_kind: kind,
    p_storage_path: storagePath,
    p_file_name: layout.fileName,
    p_rows: layout.rowCount,
    p_pages: pages,
  });
  if (recorded.error) {
    const { status, message } = refusal(recorded.error.message);
    return fail(status, message);
  }

  return { ok: true, pdf, layout, pages, documentId: recorded.data as string, storagePath };
}

/**
 * `attachment; filename="…"; filename*=UTF-8''…` — the en dash in "Client –
 * Event.pdf" survives in every browser that reads RFC 5987, and the ASCII
 * fallback keeps the rest readable.
 */
export function contentDisposition(fileName: string, inline = false): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '-').replace(/"/g, "'");
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
