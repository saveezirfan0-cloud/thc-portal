import { NextResponse } from 'next/server';

/**
 * GET /client/session — "is this browser still signed in?", for a screen
 * whose server action came back with something that was not its answer
 * (FeedbackModal: the middleware sends a lapsed session to /login, and the
 * action's fetch never sees its own result).
 *
 * The answer is the middleware's, not this handler's: a request with no
 * session is redirected to /login before it gets here, which the caller sees
 * as a redirect (`redirect: 'manual'`); a request that gets here is signed
 * in as a client. Nothing is read and nothing is returned but the status.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
