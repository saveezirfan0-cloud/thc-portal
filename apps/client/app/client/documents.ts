import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';

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

export type DocumentKind = 'allocation' | 'signout';

export interface ClientDocument {
  id: string;
  kind: DocumentKind;
  file_name: string;
  storage_path: string;
  issued_at: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the generated types
   predate this view (see data.ts). */
export async function loadDocuments(eventId: string): Promise<ClientDocument[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    return [];
  const supabase = createClient(await cookies()) as any;
  const { data, error } = await supabase
    .from('client_event_documents_v')
    .select('id, kind, file_name, storage_path, issued_at')
    .eq('event_id', eventId);
  if (error) return [];
  return (data ?? []) as ClientDocument[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
