import { NextResponse } from 'next/server';
import { isEventId } from '../../../data';
import { loadEventDocuments, signDocument } from '../../../documents';
import type { DocumentKind } from '../../../rules';

/**
 * GET /client/events/:id/document?kind=allocation|signout — §11.2's
 * "Download Allocation Timesheet" / "Download Completed Timesheet".
 *
 * The newest stored copy of that kind for this event, if the caller's own
 * session can see it through client_event_documents_v (ADR-0004, ADR-0114),
 * as a one-minute signed link. The answers:
 *
 *   · `kind` missing or not one of the two → 400. It is never guessed: a
 *     link that asked for nothing must not download the allocation sheet.
 *   · an event the caller cannot see — another customer's, or none at all —
 *     → the same plain 404 for both, so the route is no existence oracle.
 *   · the caller's own event with no copy of that kind (not issued yet, or
 *     the event was cancelled) → 303 back to the event page with
 *     `?doc=missing`, which shows an amber note above the screen.
 *   · the read or the signing failed → 303 with `?doc=unavailable`.
 *
 * Every answer is `no-store`.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const KINDS: readonly DocumentKind[] = ['allocation', 'signout'];

function isKind(value: string | null): value is DocumentKind {
  return value !== null && (KINDS as readonly string[]).includes(value);
}

function notFound(): NextResponse {
  return new NextResponse('No document for this event yet.', { status: 404, headers: NO_STORE });
}

function backToEvent(request: Request, id: string, doc: 'missing' | 'unavailable'): NextResponse {
  const url = new URL(`/client/events/${id}`, request.url);
  url.searchParams.set('doc', doc);
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get('kind');
  if (!isKind(kind)) {
    return new NextResponse('Unknown document.', { status: 400, headers: NO_STORE });
  }
  if (!isEventId(id)) return notFound();

  const { visible, documents, unavailable } = await loadEventDocuments(id);
  if (!visible) return notFound();
  if (unavailable) return backToEvent(request, id, 'unavailable');

  const doc = documents.find((d) => d.kind === kind);
  if (!doc) return backToEvent(request, id, 'missing');

  const url = await signDocument(doc);
  if (!url) return backToEvent(request, id, 'unavailable');
  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}
