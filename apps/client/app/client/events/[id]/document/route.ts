import { NextResponse } from 'next/server';
import { loadDocuments, signDocument } from '../../../documents';

/**
 * GET /client/events/:id/document?kind=allocation|signout — §11.2's
 * "Download Allocation Sheet" / "Download Signed Timesheet".
 *
 * The newest stored copy of that kind for this event, if the caller's own
 * session can see it through client_event_documents_v (ADR-0004); a
 * one-minute signed link to it otherwise nothing. Another customer's event
 * is a 404, exactly like one that has no document yet.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind =
    new URL(request.url).searchParams.get('kind') === 'signout' ? 'signout' : 'allocation';
  const doc = (await loadDocuments(id)).find((d) => d.kind === kind);
  if (!doc) return new NextResponse('No document for this event yet.', { status: 404 });
  const url = await signDocument(doc);
  if (!url)
    return new NextResponse('The document store is not available right now.', { status: 503 });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
