import {
  contentDisposition,
  documentsDb,
  drawBadges,
  isUuid,
  refusal,
  supabaseConfigured,
} from '../../_lib/generate';
import type { DocumentData } from '../../_lib/generate';

/**
 * GET /api/documents/:eventId/badges — "Download Name Badges" (ADR-0081).
 *
 * For a client with name badges on, the same badges the Allocation
 * Timesheet email carries, drawn fresh from the current line-up, so the
 * office can print a spare set or send them another way. Nothing is
 * stored: the copy of record is the one attached to a sent email.
 *
 * `event_document_data()` is the gate, as for the sheet: office only, and
 * never for a cancelled event (§3.3).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!isUuid(eventId)) return new Response('Unknown event.', { status: 400 });
  if (!supabaseConfigured())
    return new Response('This environment has no Supabase project.', { status: 503 });

  const db = await documentsDb();
  const { data, error } = await db.rpc('event_document_data', { p_event: eventId });
  if (error) {
    const { status, message } = refusal(error.message);
    return new Response(message, { status });
  }
  const doc = data as DocumentData;
  if (doc.event.nameBadges !== true)
    return new Response('Name badges are switched off on the client card.', { status: 409 });

  const badges = await drawBadges(doc, 'allocation');
  if (!badges)
    return new Response('Nobody is confirmed on this event yet, so there are no badges.', {
      status: 409,
    });

  return new Response(new Uint8Array(badges.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(badges.layout.fileName),
      'Cache-Control': 'no-store',
      'X-THC-Badges': String(badges.layout.count),
    },
  });
}
