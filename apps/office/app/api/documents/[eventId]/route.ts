import {
  contentDisposition,
  generateDocument,
  isUuid,
  parseKind,
  supabaseConfigured,
} from '../_lib/generate';
import { CROSS_SITE_REFUSAL, fetchSiteAllowed } from '../_lib/fetchSite';

/**
 * GET /api/documents/:eventId?kind=allocation|signout — "Download" (§11.4).
 *
 * The PDF itself, "so it can be dropped into WhatsApp". No time restriction:
 * the manager can download at any point, including mid-event (§11.3). Every
 * download is a freshly drawn copy — after a GDPR removal it prints "Deleted
 * account #id" and no photo (§1.7) — and is kept in the `timesheets` bucket
 * when the deployment has the key to do so.
 *
 * Because it has those side effects, a request another site started
 * (`Sec-Fetch-Site: cross-site` or `same-site`) is refused with 403 before
 * anything is read — see `_lib/fetchSite.ts` for what is allowed and why.
 *
 * Node runtime: @react-pdf/renderer needs it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  // Before any work: this GET stores and records a copy, so another site
  // must not be able to start it with a link (fetchSite.ts).
  if (!fetchSiteAllowed(request)) return new Response(CROSS_SITE_REFUSAL, { status: 403 });
  const { eventId } = await params;
  const kind = parseKind(new URL(request.url).searchParams.get('kind') ?? 'allocation');
  if (!isUuid(eventId) || !kind)
    return new Response('Unknown event or document kind.', { status: 400 });
  if (!supabaseConfigured())
    return new Response('This environment has no Supabase project.', { status: 503 });

  const result = await generateDocument(eventId, kind, 'best-effort');
  if (!result.ok) {
    if (result.detail)
      console.error('[documents] download failed', { eventId, kind, detail: result.detail });
    return new Response(result.message, { status: result.status });
  }

  return new Response(new Uint8Array(result.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(result.layout.fileName),
      'Cache-Control': 'no-store',
      'X-THC-Pages': String(result.pages),
      'X-THC-Stored': result.documentId ? 'true' : 'false',
    },
  });
}
