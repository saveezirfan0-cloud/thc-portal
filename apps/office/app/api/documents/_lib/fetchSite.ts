/**
 * Is this request one the Back Office itself made (security review, item 2)?
 *
 * GET /api/documents/:eventId has side effects — it stores a fresh copy in
 * the `timesheets` bucket and records it as issued — and the session
 * cookie is SameSite=Lax, which a browser DOES send on a top-level
 * navigation from another site. So a link or redirect on any page could
 * make a signed-in manager's browser issue documents. `Sec-Fetch-Site` is
 * set by the browser and cannot be forged by page script:
 *
 *   · `same-origin` — the Download link on the event page, the Send fetch;
 *   · `none`        — typed into the address bar, a bookmark, a reload;
 *   · `same-site` / `cross-site` — another origin started it: refused,
 *     including a sibling app on the same site (the Staff App, the Client
 *     Portal), which has no business issuing timesheets.
 *
 * ABSENT is allowed, deliberately. Every current browser sends the header
 * (Safari since 16.4), so its absence means a browser older than that or a
 * non-browser client — and a non-browser client already holding the
 * manager's cookie needs no forgery. Refusing it would break Download on an
 * old office machine to close a gap only such a browser has; the
 * database's office-only checks still stand behind it either way.
 */
export function fetchSiteAllowed(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

export const CROSS_SITE_REFUSAL =
  'This document can only be produced from the Back Office itself. Open the event and use Download.';
