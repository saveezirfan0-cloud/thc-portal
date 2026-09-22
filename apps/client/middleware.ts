import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isRole, wrongAppBody } from '@thc/db';

/**
 * Role routing for the client app (§1.4).
 *
 * This is the first of two gates. It keeps the wrong role out of the wrong
 * app and refreshes the Supabase session cookie. The second gate is RLS,
 * which is what actually protects the data: a forged URL gets past nothing.
 */
const ALLOWED_ROLE = 'client' as const;
const PUBLIC_PATHS = ['/login', '/auth'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // No Supabase configured. Locally that is the Phase 0 shell and we let
    // it render; in a deployed environment it means the auth gate is OFF,
    // and failing open there published this app to anyone with the URL.
    //
    // That is not hypothetical: marking NEXT_PUBLIC_* as "Sensitive" in
    // Vercel withholds them at BUILD time, and Next inlines NEXT_PUBLIC_*
    // at build — so they arrived undefined and every route rendered
    // unauthenticated in production. Fail closed instead.
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
    return new NextResponse(wrongAppBody(isRole(role) ? role : null, 'Client Portal'), {
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
