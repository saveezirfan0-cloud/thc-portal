import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { WRONG_APP_PATH, WRONG_APP_ROLE_HEADER, isRole, withSessionPersistence } from '@thc/db';

/**
 * Role routing for the client app (§1.4).
 *
 * This is the first of two gates. It keeps the wrong role out of the wrong
 * app and refreshes the Supabase session cookie. The second gate is RLS,
 * which is what actually protects the data: a forged URL gets past nothing.
 */
const ALLOWED_ROLE = 'client' as const;
// /forgot and /reset are A1–A3 (§10.2, `wireframes/client/login.html`):
// nobody who needs them is signed in, or they hold only the short-lived
// session /auth/callback just made. Public means "no session needed", not
// "any role": a signed-in non-client still gets the wrong-app page here, a
// reset link included — its password is for another app, and that app's own
// /reset is where it is set (reset/actions.ts no longer pretends otherwise).
const PUBLIC_PATHS = ['/login', '/forgot', '/reset', '/auth'];

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

  // The token refresh below rewrites the auth cookies. They keep the
  // lifetime this device chose at sign-in ("Keep me signed in", ADR-0032):
  // without the wrapper every refresh would make them persistent again. No
  // choice on the device (a session from before ADR-0032, a fresh device
  // after an emailed link) gets 30 days, never the library's 400: the
  // Client Portal is capped (packages/db/src/session.ts).
  const supabase = createServerClient(url, anonKey, {
    cookies: withSessionPersistence(
      {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          // httpOnly: the Client Portal has no browser Supabase client, so
          // no script needs the tokens (next.config.ts sets the same for
          // the server client through THC_AUTH_COOKIE_HTTP_ONLY).
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, { ...options, httpOnly: true });
          }
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
    // The query string too: a lapse on
    // /client/events/:id/document?kind=signout must come back to the
    // sign-out copy, not to the route's default (the allocation sheet).
    // Only ever followed as a path on this app (safeNextPath, login action).
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
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
    // Signed in, wrong app. This used to redirect to HOME_PATH[role], which
    // is a PATH — and the three apps are on three different hosts, so it
    // only ever bounced them to a local route that failed this same check
    // again. That was the ERR_TOO_MANY_REDIRECTS. A rewrite is not a
    // navigation, so it cannot loop either: the app's own sign-in card
    // (app/wrong-app, ADR-0138) answers this same request.
    return wrongApp(request, role);
  }

  // A signed-in customer has nothing to do on the sign-in card.
  if (pathname === '/login') {
    return redirectKeepingCookies(request, response, '/client');
  }

  return response;
}

/** A redirect that carries any refreshed auth cookies this request wrote. */
function redirectKeepingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

/**
 * A signed-in session this app will not admit: the same request, answered
 * by app/wrong-app (ADR-0138) with the refused role on a request header.
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
  // Static files are skipped only at the top level, where public/ serves
  // them (favicon, icons). `[^/]+`, not `.*`: a nested path that merely
  // ENDS in an image extension (/staff/x.png) is a page route and must
  // pass the gate like any other (audit D52). robots.txt is public so a
  // crawler reads "Disallow: /" rather than a redirect to the sign-in card.
  matcher: [
    '/((?!_next/static|_next/image|(?:favicon\\.ico|manifest\\.webmanifest|sw\\.js|robots\\.txt)$|[^/]+\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
