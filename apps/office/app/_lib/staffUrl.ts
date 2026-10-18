/**
 * `NEXT_PUBLIC_STAFF_URL` is the Staff App's address, read by the Back Office
 * to build links that point AT the Staff App (activation, install, /apply,
 * the privacy notice). On 13.10.2026 it was set to the Back Office's own
 * address, and for five days every manual Accept emailed a worker links on an
 * app that has none of those pages. Every reader asks here, so one misread
 * value cannot reach a worker through a different door.
 */

/** Same scheme, host and port; a malformed value is never the same. */
export function isSameOrigin(a: string, b: string | undefined): boolean {
  if (!b?.trim()) return false;
  try {
    return new URL(a.trim()).origin === new URL(b.trim()).origin;
  } catch {
    return false;
  }
}

/**
 * True when the Staff App's address is set and is the Back Office's own
 * (`NEXT_PUBLIC_OFFICE_URL`). Logged: a misconfiguration is for the operator.
 * With the office address unset there is nothing to compare, so it is false.
 */
export function staffUrlIsOffice(env: Record<string, string | undefined> = process.env): boolean {
  const staff = env['NEXT_PUBLIC_STAFF_URL'];
  if (!staff?.trim() || !isSameOrigin(staff, env['NEXT_PUBLIC_OFFICE_URL'])) return false;
  console.error('[config] NEXT_PUBLIC_STAFF_URL is the Back Office, not the Staff App', {
    origin: staff.trim().replace(/\/+$/, ''),
  });
  return true;
}
