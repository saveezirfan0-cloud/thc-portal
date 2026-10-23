import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@thc/db/admin';
import type { DocType } from '@thc/domain';
import { documentExtractor } from '../../../onboarding/extractor';
import { extractDocument } from '../../../../lib/extract';
import { checkRescanSecret } from '../../../../lib/rescan';

/**
 * POST /api/internal/rescan-document — read one pending document again with
 * the AI (§2.6, ADR-0033), for the Back Office's "Retry AI scan".
 *
 * Gate: `Authorization: Bearer <DOCUMENT_RESCAN_SECRET>` (lib/rescan.ts).
 * Body `{ "docId": "<uuid>" }`. Pre-fill only, as on upload:
 * `record_document_extraction()` never touches a document a manager has
 * already decided, and keeps any date it has no value for.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One read: 45 s an attempt, one retry, plus the Storage download.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

interface DocRow {
  doc_type: DocType;
  file_path: string | null;
  review_status: string;
}

interface DocRead {
  from(table: 'compliance_docs'): {
    select(columns: string): {
      eq(
        column: 'id',
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: DocRow | null; error: unknown }> };
    };
  };
}

export async function POST(request: Request): Promise<Response> {
  const gate = checkRescanSecret(
    request.headers.get('authorization'),
    process.env['DOCUMENT_RESCAN_SECRET'],
  );
  if (gate === 'not_configured') return json(503, { ok: false, reason: 'not_configured' });
  if (gate !== 'ok') return json(401, { ok: false, reason: 'unauthorised' });

  let docId = '';
  try {
    const body = (await request.json()) as { docId?: unknown };
    docId = typeof body.docId === 'string' ? body.docId : '';
  } catch {
    docId = '';
  }
  if (!UUID.test(docId)) return json(400, { ok: false, reason: 'bad_request' });

  if (!documentExtractor()) return json(200, { ok: false, reason: 'extractor_off' });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: doc, error } = await (admin as unknown as DocRead)
    .from('compliance_docs')
    .select('doc_type, file_path, review_status')
    .eq('id', docId)
    .maybeSingle();
  if (error || !doc) return json(404, { ok: false, reason: 'unknown_document' });
  if (doc.review_status !== 'pending') return json(200, { ok: false, reason: 'already_decided' });
  if (!doc.file_path) return json(200, { ok: false, reason: 'no_file' });

  const summary = await extractDocument(admin, docId, doc.doc_type, doc.file_path);
  if (!summary) return json(200, { ok: false, reason: 'scan_failed' });
  return json(200, { ok: true, ...summary });
}
