import { cspReportResponse } from '@thc/db/csp';

/**
 * POST /api/csp-report — where browsers send Content-Security-Policy
 * violation reports (ADR-0164). Logged, never stored; no session needed
 * (the middleware lets this one path through, POST only).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return cspReportResponse(request, 'office');
}
