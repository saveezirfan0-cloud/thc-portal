import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isRole, withSessionPersistence, wrongAppBody } from '@thc/db';

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
  // lifetime this device chose at sign-in ("Keep me signed in", ADR-0030):
  // without the wrapper every refresh would make them persistent again.
  const supabase = createServerClient(url, anonKey, {
    cookies: withSessionPersistence({
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    }),
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
    // Signed in, wrong app. This used to redirect to HOME_PATH[role], which
    // is a PATH — and the three apps are on three different hosts, so it
    // only ever bounced them to a local route that failed this same check
    // again. That was the ERR_TOO_MANY_REDIRECTS. A terminal response is
    // the only thing here that cannot loop.
    return new NextResponse(wrongAppBody(isRole(role) ? role : null, 'Staff App'), {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return response;
}

export const config = {
  matcher: [
    // The service worker and its manifest are excluded: a 302 to /login in
    // answer to a request for sw.js means no offline shell and no push.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|swe-worker-.*\\.js|workbox-.*\\.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
