import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { STATE_COOKIE, authorizeUrl, xeroEnv } from '../_lib/config';
import { xeroOperator } from '../_lib/gate';

/**
 * GET /api/xero/connect — start Xero's OAuth 2.0 authorisation-code flow
 * (ADR-0211). An owner clicks Connect on /settings -> Xero; this sets a
 * single-use `state` cookie and sends the browser to Xero's consent screen.
 * The callback refuses a return whose state does not match the cookie.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(request: Request, flag: string) {
  return NextResponse.redirect(new URL(`/settings?tab=xero&xero=${flag}`, request.url), 303);
}

export async function GET(request: Request) {
  const env = xeroEnv();
  if (!env) return back(request, 'not_configured');
  const who = await xeroOperator('owner');
  if (!who.ok) return back(request, who.status === 401 ? 'signed_out' : 'forbidden');

  const state = randomBytes(32).toString('hex');
  const response = NextResponse.redirect(authorizeUrl(env, state), 303);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax: Xero returns the browser by a top-level GET, which Lax still sends.
    sameSite: 'lax',
    path: '/api/xero',
    maxAge: 600,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
