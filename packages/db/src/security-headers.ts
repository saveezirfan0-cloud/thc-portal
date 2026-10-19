/**
 * The response headers every page and file of the three apps carries —
 * returned from each app's `next.config.ts` `headers()`.
 *
 *   X-Frame-Options / frame-ancestors  no app is ever framed (clickjacking
 *                                      on Accept, Verify, Remove…). Nothing
 *                                      here frames its own pages either.
 *   base-uri 'self'                    an injected <base> cannot re-point
 *                                      every relative link and script.
 *   form-action 'self'                 a form can only post back here; the
 *                                      server actions and /auth/signout do.
 *   object-src 'none'                  no plugins.
 *   nosniff                            a stored upload is never run as script.
 *   Referrer-Policy                    the library default, made explicit.
 *                                      A page that must send less sets its
 *                                      own (the Staff App's /activate links
 *                                      carry a token: `no-referrer` there,
 *                                      by <meta>, which wins for the page).
 *   Permissions-Policy                 the Staff App uses the location (check
 *                                      in/out, §9.5) and the camera (selfie,
 *                                      document capture); the Back Office and
 *                                      the Client Portal use neither.
 *   Strict-Transport-Security          production only: `next dev` is http.
 *
 * NO `script-src` HERE. The App Router writes inline <script> tags on every
 * page (the RSC payload) and the appearance script (`packages/ui`
 * `AppearanceScript`) runs inline before paint, so a script policy needs a
 * per-request nonce: the Back Office and Staff App middleware send one,
 * report-only for now (`csp.ts`, ADR-0164). This static CSP carries the
 * directives that cost nothing, and stays ENFORCED beside it.
 *
 * Pure: `next.config.ts` imports it at build time.
 */

export interface HeaderPair {
  key: string;
  value: string;
}

export interface HeaderRule {
  source: string;
  headers: HeaderPair[];
}

export type AppName = 'office' | 'staff' | 'client';

export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/** Two years, the HSTS preload list's minimum; subdomains included. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains';

export function permissionsPolicy(app: AppName): string {
  return app === 'staff'
    ? 'geolocation=(self), camera=(self), microphone=()'
    : 'geolocation=(), camera=(), microphone=()';
}

export function securityHeaders(
  app: AppName,
  production: boolean = process.env.NODE_ENV === 'production',
): HeaderPair[] {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: permissionsPolicy(app) },
    ...(production ? [{ key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY }] : []),
  ];
}

/** What `headers()` in `next.config.ts` returns: every path, these headers. */
export function securityHeaderRules(app: AppName, production?: boolean): HeaderRule[] {
  return [{ source: '/:path*', headers: securityHeaders(app, production) }];
}
