import {
  documentsDb,
  generateDocument,
  isUuid,
  parseKind,
  refusal,
  supabaseConfigured,
} from '../../_lib/generate';

/**
 * POST /api/documents/:eventId/send { kind } — "Send allocation sheet" (§11.4).
 *
 * Draws a fresh copy, stores it (required: the drain attaches from the
 * `timesheets` bucket), and queues one email from timesheets@ to every
 * contact email on the client card (§9.7, §9.12) through
 * `queue_event_document_email()`. The email itself goes when the outbox
 * drain (P2) is live; until then it is queued, and the response says so.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  let body: { kind?: unknown } = {};
  try {
    body = (await request.json()) as { kind?: unknown };
  } catch {
    // An empty body is an allocation sheet, the default action.
  }
  const kind = parseKind(body.kind ?? 'allocation');
  if (!isUuid(eventId) || !kind)
    return Response.json({ error: 'Unknown event or document kind.' }, { status: 400 });
  if (!supabaseConfigured())
    return Response.json({ error: 'This environment has no Supabase project.' }, { status: 503 });

  const result = await generateDocument(eventId, kind, 'required');
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });

  const db = await documentsDb();
  const queued = await db.rpc('queue_event_document_email', { p_document: result.documentId! });
  if (queued.error) {
    const { status, message } = refusal(queued.error.message);
    return Response.json({ error: message }, { status });
  }

  const { recipients } = queued.data as { key: string; recipients: string[] };
  return Response.json({
    ok: true,
    documentId: result.documentId,
    fileName: result.layout.fileName,
    pages: result.pages,
    rows: result.layout.rowCount,
    recipients,
  });
}
