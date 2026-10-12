import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import type { DocumentKind } from './rules';

/**
 * The two PDFs on the Client Portal (§11.1, §11.2): the allocation sheet
 * before the event, the sign-out timesheet after it. Download only — the
 * sending is the office's (§11.4).
 *
 * ADR-0004's path: the caller's own session reads `client_event_documents_v`,
 * an owner-rights view that applies `client_portal_visible()` in its body and
 * names its columns. No money is on the document (§11.1). The PDF lives in
 * the private, service-role-only `timesheets` bucket, so — exactly as
 * `photos.ts` does for the line-up selfies — the service key is used ONLY to
 * sign a path that view has already returned for this caller, for a minute.
 */

export type { DocumentKind };

export interface ClientDocument {
  id: string;
  kind: DocumentKind;
  file_name: string;
  storage_path: string;
  issued_at: string;
}

const DOCUMENT_COLUMNS = 'id, event_id, kind, file_name, storage_path, issued_at';

/**
 * A documents read. `unavailable` is true when the view could not be read,
 * so a screen can say "couldn't be loaded" instead of mistaking a failure
 * for "THC has not issued this document yet". The database's message goes
 * to the server log only.
 */
export interface DocumentsLoad<T extends ClientDocument = ClientDocument> {
  documents: T[];
  unavailable: boolean;
}

/** What a page says above the screen when `unavailable` is true. */
export const DOCUMENTS_UNAVAILABLE =
  "Documents couldn't be loaded just now — refresh to try again.";

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the generated types
   predate this view (see data.ts). */
export async function loadDocuments(eventId: string): Promise<DocumentsLoad> {
  if (!configured()) return { documents: [], unavailable: false };
  try {
    const supabase = createClient(await cookies()) as any;
    const { data, error } = await supabase
      .from('client_event_documents_v')
      .select(DOCUMENT_COLUMNS)
      .eq('event_id', eventId);
    if (error) {
      console.error('[client] documents load failed', { eventId, error });
      return { documents: [], unavailable: true };
    }
    return { documents: (data ?? []) as ClientDocument[], unavailable: false };
  } catch (error) {
    console.error('[client] documents load threw', { eventId, error });
    return { documents: [], unavailable: true };
  }
}

/**
 * §11.1 · every document this customer can download, for the list — one
 * query for the whole page rather than one per row. There is deliberately
 * no filter: the view scopes itself to the caller's own events (ADR-0004),
 * exactly as `loadEventList` reads the other three.
 */
export async function loadAllDocuments(): Promise<
  DocumentsLoad<ClientDocument & { event_id: string }>
> {
  if (!configured()) return { documents: [], unavailable: false };
  try {
    const supabase = createClient(await cookies()) as any;
    const { data, error } = await supabase
      .from('client_event_documents_v')
      .select(DOCUMENT_COLUMNS);
    if (error) {
      console.error('[client] documents load failed', { error });
      return { documents: [], unavailable: true };
    }
    return {
      documents: (data ?? []) as (ClientDocument & { event_id: string })[],
      unavailable: false,
    };
  } catch (error) {
    console.error('[client] documents load threw', { error });
    return { documents: [], unavailable: true };
  }
}

/**
 * The download route's read: is the event the caller's (`client_events_v`,
 * the same answer the event page gets), and which copies does it have.
 *
 * `visible: false` only when the view positively returned no row — another
 * customer's event and a nonexistent one alike, which the route answers
 * with one identical 404 (ADR-0004). A failed read is `unavailable`, not
 * "invisible": it says nothing about whose event it is.
 */
export async function loadEventDocuments(
  eventId: string,
): Promise<DocumentsLoad & { visible: boolean }> {
  if (!configured()) return { visible: false, documents: [], unavailable: false };
  try {
    const supabase = createClient(await cookies()) as any;
    const [event, docs] = await Promise.all([
      supabase.from('client_events_v').select('id').eq('id', eventId).maybeSingle(),
      supabase.from('client_event_documents_v').select(DOCUMENT_COLUMNS).eq('event_id', eventId),
    ]);
    if (event.error || docs.error) {
      if (event.error?.code === '22P02')
        return { visible: false, documents: [], unavailable: false };
      console.error('[client] document route load failed', {
        eventId,
        event: event.error,
        documents: docs.error,
      });
      return { visible: true, documents: [], unavailable: true };
    }
    if (!event.data) return { visible: false, documents: [], unavailable: false };
    return { visible: true, documents: (docs.data ?? []) as ClientDocument[], unavailable: false };
  } catch (error) {
    console.error('[client] document route load threw', { eventId, error });
    return { visible: true, documents: [], unavailable: true };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The kinds issued per event, keyed by event id — what the list renders from. */
export function kindsByEvent(
  docs: readonly { event_id: string; kind: DocumentKind }[],
): Record<string, DocumentKind[]> {
  const out: Record<string, DocumentKind[]> = {};
  for (const d of docs) (out[d.event_id] ??= []).push(d.kind);
  return out;
}

const TTL_SECONDS = 60;

/** A one-minute download link for a document the view returned, or null. */
export async function signDocument(doc: ClientDocument): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from('timesheets')
      .createSignedUrl(doc.storage_path, TTL_SECONDS, { download: doc.file_name });
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}
