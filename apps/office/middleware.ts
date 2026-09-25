import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isRole, wrongAppBody } from '@thc/db';

/**
 * Role routing for the admin app (§1.4).
 *
 * This is the first of two gates. It keeps the wrong role out of the wrong
 * app and refreshes the Supabase session cookie. The second gate is RLS,
 * which is what actually protects the data: a forged URL gets past nothing.
 */
const ALLOWED_ROLE = 'admin' as const;
const PUBLIC_PATHS = ['/login', '/auth'];

/**
 * The component gallery renders sample copy only, but it is the whole admin
 * component library and its vocabulary (Wave 2, margin, Auto-assign, Willo)
 * on the admin host. The security brief lists every surface reachable
 * without a session, and this was not on it (invariant 6). It stays open
 * where it is looked at — local, CI's `next start`, Vercel previews — and
 * on the production deployment it is a signed-in admin page like the rest.
 */
const PREVIEW_PATHS = ['/design-system'];

function isPublic(pathname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const open = env.VERCEL_ENV === 'production' ? PUBLIC_PATHS : [...PUBLIC_PATHS, ...PREVIEW_PATHS];
  return open.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
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
    return new NextResponse(wrongAppBody(isRole(role) ? role : null, 'Back Office'), {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
