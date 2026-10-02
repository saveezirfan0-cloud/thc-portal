import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import {
  countPdfPages,
  layoutBadges,
  layoutSheet,
  photoFormat,
  renderBadgesPdf,
  renderSheetPdf,
} from '@thc/pdf';
import type {
  BadgeLayout,
  SheetEvent,
  SheetKind,
  SheetLayout,
  SheetPerson,
  SheetPhoto,
} from '@thc/pdf';

/**
 * Draw, and keep, one Allocation Timesheet or Completed Allocation Timesheet
 * (the "sign-out" state in code) — §11.3, §11.4, names per ADR-0074.
 *
 * Two callers: the event page's Download / Send, as the signed-in manager,
 * and the event-documents job (ADR-0074), which passes the service-role
 * client and `automatic: true` — the copy is then recorded through
 * `record_event_document_autosend()` (generated_by null, automatic).
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
 * 5. ADR-0081: for an Allocation Timesheet whose client has name badges on
 *    (`event.nameBadges`), the badges too — one per person on the sheet —
 *    stored beside it and attached to the same copy through
 *    `attach_event_document_badges()`, so the D1 email carries both.
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
      /** ADR-0081: the name badges drawn with this copy, when the client has them. */
      badges: { layout: BadgeLayout; pdf: Buffer; storagePath: string | null } | null;
    }
  | { ok: false; status: number; message: string };

export interface DocumentRpc {
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
    fn: 'record_event_document_autosend',
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
    fn: 'attach_event_document_badges',
    args: { p_document: string; p_storage_path: string; p_file_name: string; p_count: number },
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
      message: 'This event is cancelled, so no Allocation Timesheet is generated.',
    };
  if (message.includes('event_not_found'))
    return { status: 404, message: 'That event does not exist.' };
  if (message.includes('client_has_no_contact_email'))
    return { status: 409, message: 'The client card has no contact email to send to.' };
  if (message.includes('client_has_no_name_badges'))
    return { status: 409, message: 'Name badges are switched off on the client card.' };
  return { status: 500, message };
}

export interface DocumentData {
  /** `nameBadges` (ADR-0081) is absent on a database before 20261002112000. */
  event: SheetEvent & { contactEmails: string[]; nameBadges?: boolean };
  rows: SheetPerson[];
}

/**
 * ADR-0081: the name badges for an event, drawn from the same data as its
 * sheet — or null when the client has none, the event is past its
 * Allocation Timesheet, or nobody on the sheet can wear one.
 */
export async function drawBadges(
  data: DocumentData,
  kind: SheetKind,
): Promise<{ layout: BadgeLayout; pdf: Buffer } | null> {
  if (kind !== 'allocation' || data.event.nameBadges !== true) return null;
  const layout = layoutBadges({ event: data.event, people: data.rows });
  if (layout.count === 0) return null;
  return { layout, pdf: await renderBadgesPdf(layout) };
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

export interface GenerateOptions {
  /** The client to read, fetch photos and record through. Default: the manager's session. */
  db?: DocumentRpc;
  /** The event-documents job's copy (ADR-0074): recorded as automatic, generated_by null. */
  automatic?: boolean;
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
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const db = options.db ?? (await documentsDb());
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
  // ADR-0081: a Send needs the badges the client asked for; a Download
  // never loses the sheet over them.
  let drawn: Awaited<ReturnType<typeof drawBadges>>;
  try {
    drawn = await drawBadges(doc, kind);
  } catch (cause) {
    if (store === 'required')
      return {
        ok: false,
        status: 500,
        message: `The name badges could not be drawn: ${(cause as Error).message}`,
      };
    drawn = null;
  }
  const unstoredBadges = drawn ? { ...drawn, storagePath: null } : null;

  const unstored = {
    ok: true as const,
    pdf,
    layout,
    pages,
    documentId: null,
    storagePath: null,
    badges: unstoredBadges,
  };
  const fail = (status: number, message: string): GenerateResult =>
    store === 'required' ? { ok: false, status, message } : unstored;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(
      503,
      'The timesheets bucket needs SUPABASE_SERVICE_ROLE_KEY on this deployment, so the PDF cannot be stored or sent. Download still works.',
    );
  }

  const now = stamp(new Date());
  const storagePath = `${eventId}/${kind}/${now}.pdf`;
  // ADR-0081: beside the sheet, never over an earlier copy's badges.
  let badgesPath = drawn ? `${eventId}/badges/${now}.pdf` : null;
  try {
    const admin = createAdminClient();
    const upload = await admin.storage
      .from('timesheets')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (upload.error) return fail(502, `Storage refused the PDF: ${upload.error.message}`);
    if (drawn && badgesPath) {
      const badges = await admin.storage
        .from('timesheets')
        .upload(badgesPath, drawn.pdf, { contentType: 'application/pdf', upsert: false });
      if (badges.error) {
        if (store === 'required')
          return fail(502, `Storage refused the name badges PDF: ${badges.error.message}`);
        // A Download: keep the record of the sheet that was handed out.
        badgesPath = null;
      }
    }
  } catch (cause) {
    return fail(502, `Storage is unreachable: ${(cause as Error).message}`);
  }

  const record = {
    p_event: eventId,
    p_kind: kind,
    p_storage_path: storagePath,
    p_file_name: layout.fileName,
    p_rows: layout.rowCount,
    p_pages: pages,
  };
  const recorded = options.automatic
    ? await db.rpc('record_event_document_autosend', record)
    : await db.rpc('record_event_document', record);
  if (recorded.error) {
    const { status, message } = refusal(recorded.error.message);
    return fail(status, message);
  }
  const documentId = recorded.data as string;

  // ADR-0081: the badges join the copy before anything queues its email. A
  // Send that cannot attach them stops here rather than email the sheet
  // without the badges the client asked for; the job releases its claim
  // and tries again on the next run.
  if (drawn && badgesPath) {
    const attached = await db.rpc('attach_event_document_badges', {
      p_document: documentId,
      p_storage_path: badgesPath,
      p_file_name: drawn.layout.fileName,
      p_count: drawn.layout.count,
    });
    if (attached.error) {
      const { status, message } = refusal(attached.error.message);
      if (store === 'required') return { ok: false, status, message };
      return { ...unstored, documentId, storagePath };
    }
  }

  return {
    ok: true,
    pdf,
    layout,
    pages,
    documentId,
    storagePath,
    badges: drawn ? { ...drawn, storagePath: badgesPath } : null,
  };
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
