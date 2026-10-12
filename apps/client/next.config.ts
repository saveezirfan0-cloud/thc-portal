import type { NextConfig } from 'next';

/**
 * Response headers on every Client Portal route (security review 12.10).
 *
 * The portal shows a venue's events, line-ups with photos and the signed
 * timesheets, behind a sign-in form — exactly what clickjacking and a
 * leaky Referer go after.
 *
 *   · X-Frame-Options DENY + CSP frame-ancestors 'none': never framed.
 *   · CSP is deliberately NOT a full script/style policy: Next.js injects
 *     inline bootstrap scripts and styles, and a policy for those needs a
 *     per-request nonce threaded through the middleware. What ships is the
 *     part that cannot break a page: frame-ancestors, base-uri 'none' (no
 *     <base> rewriting relative URLs), object-src 'none' (no plugins),
 *     form-action 'self' (a form — sign-in, reset, sign-out — posts only
 *     back here).
 *   · Referrer-Policy same-origin: an /auth/confirm?token_hash=… or an
 *     event URL never reaches another site in a Referer.
 *   · Permissions-Policy: the portal uses no camera, microphone or
 *     location, so no page — or anything injected into one — can ask.
 *   · nosniff: a served document is what its Content-Type says.
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
  },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: {
    APP_TZ: process.env.APP_TZ ?? 'Europe/London',
    // The Client Portal has no browser Supabase client (no
    // `@thc/db/browser` import anywhere in apps/client), so its auth cookies
    // are written httpOnly: a script injected into a page cannot read the
    // session. Read by the server client (packages/db/src/server.ts); the
    // middleware sets the same flag on its token refresh.
    THC_AUTH_COOKIE_HTTP_ONLY: '1',
  },
  async headers() {
    return [{ source: '/:path*', headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
