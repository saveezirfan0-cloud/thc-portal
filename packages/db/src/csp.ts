/**
 * The per-request Content-Security-Policy of the Back Office and the Staff
 * App (ADR-0164; security audit M2).
 *
 * `security-headers.ts` keeps the static headers every response carries,
 * its CSP included (frame-ancestors, base-uri, form-action, object-src —
 * the directives that cost nothing and are ENFORCED today). This module is
 * the script policy that needs a fresh nonce on every request, so each
 * app's middleware builds it:
 *
 *   1. `createNonce()` — 16 random bytes, base64.
 *   2. The policy goes on the REQUEST headers as well as the response.
 *      Next.js reads the nonce from the request's CSP header
 *      (`content-security-policy`, or `-report-only`) and puts it on every
 *      inline <script> it renders — the RSC payload, the bootstrap — so
 *      dynamically rendered pages need nothing else.
 *   3. `'strict-dynamic'`: a script the nonce'd ones load is trusted too,
 *      and nothing else is — no host list to keep up to date for scripts.
 *   4. The one inline script of our own, the appearance script that runs
 *      before paint (`packages/ui` AppearanceScript), is allowed by its
 *      hash, so the layouts need not read the nonce. A test in each app
 *      recomputes the hash from the script itself.
 *
 * SHIPPED AS REPORT-ONLY. Violations are reported to `CSP_REPORT_PATH` and
 * logged; nothing is blocked. Enforcing is the one line `CSP_HEADER` below.
 * Before flipping it, read the reports for a week: a page served as static
 * HTML (prerendered at build) carries no nonce on Next's inline scripts and
 * would stop hydrating once enforced — see ADR-0164 "Switching to enforce".
 *
 * Pure (no Next, no environment reads): the middleware passes what it knows.
 */

import { readBodyCapped } from './willo';

/** The header the policy travels in. Enforce: 'content-security-policy'. */
export const CSP_HEADER = 'content-security-policy-report-only';

/** The nonce, for a server component that renders a <script> of its own. */
export const NONCE_HEADER = 'x-nonce';

/** Where browsers post violation reports (a route in each app). */
export const CSP_REPORT_PATH = '/api/csp-report';

/**
 * `'sha256-…'` of `appearanceScript` (packages/ui/src/components/
 * Appearance.tsx). Pinned here so the middleware does not import React;
 * `app/__tests__/csp.test.ts` in both apps fails when the script changes
 * and this does not.
 */
export const APPEARANCE_SCRIPT_HASH = "'sha256-W5pkGkpGMZ9KLsG0RsMkBiTNXU4PkbPhcn0t3i5dcEo='";

export type CspApp = 'office' | 'staff';

export interface CspOptions {
  app: CspApp;
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL: the API, Storage (images, uploads) and Realtime. */
  supabaseUrl: string | undefined;
  /** `next dev`: React's dev runtime evaluates strings and HMR uses a socket. */
  dev?: boolean;
}

/** 16 random bytes, base64 — the shape Next accepts as a nonce. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** `https://<ref>.supabase.co` and its `wss://` twin, or nothing for a bad value. */
export function supabaseOrigins(url: string | undefined): { http: string; ws: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const ws = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
    return { http: parsed.origin, ws };
  } catch {
    return null;
  }
}

/**
 * Where each app's pages load from, read from the code (19.10.2026):
 *
 *   connect  the Supabase browser client — Storage uploads (documents,
 *            selfies, office evidence) and Realtime (the check-in monitor).
 *            Geocoding (Mapbox, Nominatim, postcodes.io) runs in server
 *            actions, never the browser. Web Push needs no connect-src: the
 *            browser's push service is reached by the browser itself, and
 *            the server sends to it.
 *   img      Supabase Storage signed URLs, Mapbox raster tiles (venue map,
 *            the shift and onboarding pin maps), OpenStreetMap tiles (the
 *            venue map's fallback), the TOTP QR code (data:) and camera
 *            previews (blob:).
 */
const MAPBOX_TILES = 'https://api.mapbox.com';
const OSM_TILES = 'https://tile.openstreetmap.org';

export function contentSecurityPolicy({ app, nonce, supabaseUrl, dev = false }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const img = ["'self'", 'data:', 'blob:', MAPBOX_TILES];
  if (app === 'office') img.push(OSM_TILES);
  if (supabase) img.push(supabase.http);
  const connect = ["'self'"];
  if (supabase) connect.push(supabase.http, supabase.ws);
  if (dev) connect.push('ws:');

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        APPEARANCE_SCRIPT_HASH,
        ...(dev ? ["'unsafe-eval'"] : []),
      ],
    ],
    // React's style={…} and Next's inline <style> tags. A style cannot run
    // script, so this is not the hole script-src closes.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', img],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['frame-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    // As the enforced static header (security-headers.ts). Browsers ignore
    // it in a report-only policy; it is here for the day this is enforced.
    ['frame-ancestors', ["'none'"]],
    ['report-uri', [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/**
 * One violation report, as much of it as is worth a log line. Both shapes
 * browsers send: `application/csp-report` ({"csp-report": {...}}) and the
 * Reporting API's `application/reports+json` ([{type, body: {...}}]).
 * Never the page's query string (it can carry a token): URLs are cut at
 * `?` and `#`.
 */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  disposition: string;
  sample: string;
}

function trimUrl(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text.split(/[?#]/)[0]?.slice(0, 200) ?? '';
}

function text(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function readCspReports(body: unknown): CspViolation[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const entry of body.slice(0, 20)) {
      const inner = (entry as { body?: unknown } | null)?.body;
      if (inner && typeof inner === 'object') items.push(inner as Record<string, unknown>);
    }
  } else if (body && typeof body === 'object') {
    const inner = (body as Record<string, unknown>)['csp-report'];
    if (inner && typeof inner === 'object') items.push(inner as Record<string, unknown>);
  }
  return items.map((r) => ({
    directive: text(r['effective-directive'] ?? r['effectiveDirective'] ?? r['violated-directive']),
    blocked: trimUrl(r['blocked-uri'] ?? r['blockedURL']),
    page: trimUrl(r['document-uri'] ?? r['documentURL']),
    disposition: text(r['disposition'], 20),
    sample: text(r['script-sample'] ?? r['sample'], 80),
  }));
}

/** A report is a few hundred bytes; anything bigger is not one. */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/**
 * The report route's whole job (`app/api/csp-report/route.ts` in each app):
 * read at most `CSP_REPORT_MAX_BYTES`, log up to five violations as one
 * warning each (no query strings, no cookies, no IP), answer 204. It grants
 * nothing and stores nothing, so the middleware lets it through without a
 * session — browsers send reports from the sign-in page too, and never
 * follow a redirect for one.
 */
export async function cspReportResponse(
  request: Request,
  app: CspApp,
  log: (message: string, details: Record<string, string>) => void = console.warn,
): Promise<Response> {
  const raw = await readBodyCapped(request, CSP_REPORT_MAX_BYTES).catch(() => null);
  if (raw === null) return new Response(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  for (const violation of readCspReports(body).slice(0, 5)) {
    log('[csp] violation (report-only)', { app, ...violation });
  }
  return new Response(null, { status: 204 });
}
