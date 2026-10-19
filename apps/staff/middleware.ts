import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  SESSION_CHECK_TIMEOUT_MS,
  WRONG_APP_PATH,
  WRONG_APP_ROLE_HEADER,
  createRequestTimeoutFetch,
  isRole,
  isTransientAuthFailure,
  withSessionPersistence,
} from '@thc/db';
import {
  CSP_HEADER,
  CSP_REPORT_PATH,
  NONCE_HEADER,
  contentSecurityPolicy,
  createNonce,
} from '@thc/db/csp';
import { createSessionCheckCache, sessionKey } from './app/login/session-check';

/**
 * Role routing for the staff app (§1.4).
 *
 * This is the first of two gates. It keeps the wrong role out of the wrong
 * app and refreshes the Supabase session cookie. The second gate is RLS,
 * which is what actually protects the data: a forged URL gets past nothing.
 */
const ALLOWED_ROLE = 'staff' as const;
// §10.2's auth screens and the two PWA screens that must render before
// there is a session: /install is where the activation email hands off
// (§2.7, ADR-0001) and /offline is what the service worker serves when the
// network is gone — a redirect to /login there would be a sign-in screen
// that cannot load either. /privacy is the notice the /apply consent links
// to (§1.7): an applicant has to be able to read it before they have an
// account, not be sent to a sign-in screen mid-consent (D3).
const PUBLIC_PATHS = [
  '/login',
  '/auth',
  '/apply',
  '/privacy',
  '/activate',
  '/forgot',
  '/reset',
  '/install',
  '/offline',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Ending a session is allowed to anyone holding one, whatever their role.
 *
 * Without this the role gate answers the POST with the wrong-app page rather
 * than passing it to the route handler, so the one button on that page
 * re-renders the page: signed in, admitted nowhere, unable to sign out and
 * switch accounts (§1.4).
 *
 * It runs before the Supabase client is built, not merely before the role
 * gate, so the two never fight over the same cookies. `getClaims()` refreshes
 * an access token near expiry and writes fresh `sb-*-auth-token` cookies on
 * to this response; the route handler then deletes them. Both Set-Cookie
 * headers would ride the same response and the survivor would be whichever
 * Next.js merged last — an intermittently ineffective sign-out. Skipping the
 * client removes the race, and the round-trip with it.
 *
 * This authorises nothing new: `/auth` is already in PUBLIC_PATHS, so a
 * sessionless request reaches this route anyway. Restricted to POST because
 * that is all the route exports; a GET page added here later must not
 * inherit an exemption from the role gate by accident.
 */
const SIGN_OUT_PATH = '/auth/signout';

/**
 * What GoTrue last said about each live session, per server instance
 * (ADR-0108, as the Back Office). Module scope on purpose: it outlives a
 * request, so a worker moving between tabs — and the location pings and
 * push saves behind them — costs one `getUser()` a minute, not one per
 * request.
 */
const sessionChecks = createSessionCheckCache();

/**
 * Every response carries the per-request script policy (ADR-0164, audit
 * M2), as the Back Office's: a fresh nonce, on the REQUEST headers too,
 * which is where Next.js reads it for the inline scripts it renders.
 * Report-only for now (`CSP_HEADER`, packages/db/src/csp.ts). sw.js and the
 * static files are outside the matcher, so the service worker is unaffected.
 */
export async function middleware(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy({
    app: 'staff',
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV === 'development',
  });
  request.headers.set(CSP_HEADER, csp);
  request.headers.set(NONCE_HEADER, nonce);
  const response = await gate(request);
  response.headers.set(CSP_HEADER, csp);
  return response;
}

async function gate(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // No Supabase configured. Locally that is the Phase 0 shell and we let
    // it render; in a deployed environment it means this gate is OFF, and
    // failing open there publishes the app to anyone with the URL.
    //
    // Measured, not theoretical: the deployed Client Portal served /client
    // to an unauthenticated request with 200 and the whole page, because
    // its two NEXT_PUBLIC_SUPABASE_* values were never filled in on that
    // Vercel project. The Back Office and Staff App, whose values are set,
    // redirected to /login from the same test — so the cause is an empty
    // value on one project, not anything about how Vercel stores them.
    //
    // Which is the point: a gate must not decide it is unnecessary because
    // its own configuration is missing. Fail closed.
    if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
      return new NextResponse(
        'This deployment is not configured: NEXT_PUBLIC_SUPABASE_URL / ' +
          'NEXT_PUBLIC_SUPABASE_ANON_KEY did not reach the build, so the ' +
          'sign-in gate cannot run. Refusing to serve without it.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
    return response;
  }

  if (request.nextUrl.pathname === SIGN_OUT_PATH && request.method === 'POST') {
    return response;
  }
  // Violation reports come with no session (from /login, /apply too) and a
  // browser never follows a redirect for one. Logged only (ADR-0164).
  if (request.nextUrl.pathname === CSP_REPORT_PATH && request.method === 'POST') {
    return response;
  }

  // The token refresh below rewrites the auth cookies. They keep the
  // lifetime this device chose at sign-in ("Keep me signed in", ADR-0032).
  // The Staff App has no box, so there is no choice to keep: `fallback: null`
  // passes the library's options through and a worker stays signed in.
  const supabase = createServerClient(url, anonKey, {
    // Reads give up after 10 s and the GoTrue session check after 4 s
    // (ADR-0154): on 17.10 a stalled call held the middleware to Vercel's
    // 25 s limit and the page answered 504. Writes are never cut off.
    global: { fetch: createRequestTimeoutFetch({ getUserMs: SESSION_CHECK_TIMEOUT_MS }) },
    cookies: withSessionPersistence(
      {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
      { fallback: null },
    ),
  });

  // The token is verified HERE, on every request, against the project's
  // published signing keys (no network once they are cached) and refreshed
  // if it is about to expire (go-live audit H2; ADR-0108). What it cannot
  // tell us — has the session been revoked — is asked of GoTrue below, at
  // most once a minute per session.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;

  const { pathname } = request.nextUrl;

  if (!claims?.sub) {
    if (isPublic(pathname)) return response;
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // app_metadata ONLY. user_metadata is writable by the user from the
  // browser — `supabase.auth.updateUser({ data: { role: 'admin' } })` — so
  // reading it here, even as a fallback, is a self-service role change.
  const role = claims.app_metadata?.['role'];
  // And an allow-list, not a deny-list: the old `isRole(role) && role !== …`
  // admitted a session whose role was missing from both places, because the
  // redirect only fired when the value parsed. Unknown role = not this app.
  if (!isRole(role) || role !== ALLOWED_ROLE) {
    // Signed in, wrong app. This used to redirect to HOME_PATH[role], which
    // is a PATH — and the three apps are on three different hosts, so it
    // only ever bounced them to a local route that failed this same check
    // again. That was the ERR_TOO_MANY_REDIRECTS. A rewrite is not a
    // navigation, so it cannot loop either: the app's own sign-in card
    // (app/wrong-app, ADR-0140) answers this same request.
    return wrongApp(request, role);
  }

  // A session GoTrue no longer knows (signed out on another device, the
  // login removed or switched off) is a signed-out request, as it was when
  // every request asked. Between asks the last answer stands; the data was
  // never at stake in that minute — RLS and `staff_caller()` decide every
  // row from the database, not from this gate.
  if (!isPublic(pathname)) {
    const key = sessionKey(claims);
    let check = sessionChecks.get(key);
    if (!check) {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      // GoTrue slow, down or rate-limiting is no answer about the session:
      // not cached, and not a sign-out (ADR-0154). The token was verified
      // above and RLS decides every row, so the worker carries on; the next
      // request asks again.
      if (!user && isTransientAuthFailure(error)) return response;
      check = { valid: !!user };
      sessionChecks.set(key, check);
    }
    if (!check.valid) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return withCookies(NextResponse.redirect(url), response);
    }
  }

  return response;
}

/**
 * A redirect built after the token refresh has to carry the refreshed auth
 * cookies too, or the browser keeps the old ones and the next request
 * refreshes (and rotates the refresh token) all over again.
 */
function withCookies(redirect: NextResponse, from: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

/**
 * A signed-in session this app will not admit: the same request, answered
 * by app/wrong-app (ADR-0140) with the refused role on a request header.
 * The address bar keeps the URL that was asked for; 403 says why.
 */
function wrongApp(request: NextRequest, role: unknown): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = WRONG_APP_PATH;
  url.search = '';
  const headers = new Headers(request.headers);
  headers.set(WRONG_APP_ROLE_HEADER, isRole(role) ? role : 'none');
  return NextResponse.rewrite(url, { status: 403, request: { headers } });
}

export const config = {
  matcher: [
    // The service worker and its manifest are excluded: a 302 to /login in
    // answer to a request for sw.js means no offline shell and no push.
    // Other static files are skipped only where public/ serves them: the
    // top level and public/icons/ (the push badge). A nested page path
    // that merely ENDS in an image extension (/shifts/x.png) is a page
    // route and must pass the gate like any other (audit D52).
    //
    // public/induction/ and public/quiz/ stay gated. /quiz/ is also a page
    // route (/quiz/[id]), so skipping "/quiz/<anything>.svg" would let a
    // page past the gate; and since the gate verifies the token locally,
    // passing through it costs those images no network round trip.
    '/((?!_next/static|_next/image|(?:favicon\\.ico|manifest\\.webmanifest|sw\\.js)$|(?:swe-worker|workbox)-[^/]*\\.js$|(?:icons/)?[^/]+\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
