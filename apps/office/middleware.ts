import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isRole, withSessionPersistence, wrongAppBody } from '@thc/db';
import {
  aalFromAccessToken,
  nextLevelFor,
  twoStepDecision,
  verifyStepPath,
} from './app/login/two-step';

/**
 * Role routing for the admin app (§1.4).
 *
 * This is the first of two gates. It keeps the wrong role out of the wrong
 * app and refreshes the Supabase session cookie. The second gate is RLS,
 * which is what actually protects the data: a forged URL gets past nothing.
 */
const ALLOWED_ROLE = 'admin' as const;
// /forgot and /reset are A1–A3 (§10.2): nobody who needs them is signed in,
// or they hold only the short-lived session /auth/callback just made.
const PUBLIC_PATHS = ['/login', '/forgot', '/reset', '/auth', '/design-system'];

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
 * gate, so the two never fight over the same cookies. `getUser()` refreshes
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
 * The job routes pg_cron calls (ADR-0025). They carry no Supabase session —
 * they are machine-to-machine — and gate themselves on a bearer secret in
 * constant time (RTW_JOB_SECRET), refusing everything when it is unset. So
 * the session gate steps aside for exactly these paths and POST only; a
 * page added under /api/jobs later does not inherit the exemption.
 */
const JOB_PATHS = ['/api/jobs/rtw-check'];

export async function middleware(request: NextRequest) {
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
  if (JOB_PATHS.includes(request.nextUrl.pathname) && request.method === 'POST') {
    return response;
  }

  // The token refresh below rewrites the auth cookies. They keep the
  // lifetime this device chose at sign-in ("Keep me signed in", ADR-0032):
  // without the wrapper every refresh would make them persistent again. No
  // choice on the device (a session from before ADR-0032, a fresh device
  // after an emailed link) gets 30 days, never the library's 400: the
  // Back Office is capped (packages/db/src/session.ts).
  const supabase = createServerClient(url, anonKey, {
    cookies: withSessionPersistence(
      {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
      { fallback: 'persistent' },
    ),
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (isPublic(pathname)) return response;
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // app_metadata ONLY. user_metadata is writable by the user from the
  // browser — `supabase.auth.updateUser({ data: { role: 'admin' } })` — so
  // reading it here, even as a fallback, is a self-service role change.
  const role = user.app_metadata?.['role'];
  // And an allow-list, not a deny-list: the old `isRole(role) && role !== …`
  // admitted a session whose role was missing from both places, because the
  // redirect only fired when the value parsed. Unknown role = not this app.
  if (!isRole(role) || role !== ALLOWED_ROLE) {
    // A wrong-role session may still reach the public pages. They grant
    // nothing an anonymous visitor does not already get, and /login is
    // where the wireframe's refusal lives: `wireframes/backoffice/login.html`
    // says a client-portal account "is refused the same way" as a wrong
    // password — the generic message on the form, which signIn() gives
    // after dropping the session (app/login/actions.ts). Without this, a
    // client holding a session here could not even see the form: its POST
    // is also a request to /login, and would get the page below instead.
    if (isPublic(pathname)) return response;

    // Signed in, wrong app. This used to redirect to HOME_PATH[role], which
    // is a PATH — and the three apps are on three different hosts, so it
    // only ever bounced them to a local route that failed this same check
    // again. That was the ERR_TOO_MANY_REDIRECTS. A terminal response is
    // the only thing here that cannot loop.
    return new NextResponse(wrongAppBody(isRole(role) ? role : null, 'Back Office'), {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Two-step sign-in (ADR-0051). An admin whose login has a verified
  // authenticator, holding a session that has not yet been through the code
  // step (aal1 — a password alone), reaches nothing but the public pages
  // until it has. /login/verify is under /login, and sign-out is answered
  // above, so neither the code step nor the way out can loop.
  //
  // The factor list is `getUser()`'s — GoTrue's answer, not the copy of the
  // user in the cookie, which the browser can edit (auth-js's own
  // getAuthenticatorAssuranceLevel() reads that copy). The aal claim is read
  // from the access token getUser() has just had GoTrue accept.
  if (!isPublic(pathname) && nextLevelFor(user.factors) === 'aal2') {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const decision = twoStepDecision({
      currentLevel: aalFromAccessToken(session?.access_token),
      nextLevel: 'aal2',
    });
    if (decision === 'verify') {
      const target = request.nextUrl.clone();
      const [path, query = ''] = verifyStepPath(pathname + request.nextUrl.search).split('?');
      target.pathname = path ?? '/login/verify';
      target.search = query ? `?${query}` : '';
      return withCookies(NextResponse.redirect(target), response);
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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
