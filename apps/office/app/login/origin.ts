/**
 * The Back Office's own public origin — where the password-reset email's
 * link must come back to (A1 → A2 → the emailed link → /login/callback →
 * A3, §10.2). Configuration, never the request's Host header: an emailed
 * link built from a header an attacker can set is a phishing kit signed
 * by THC's own sender (§9.12).
 *
 * Vercel sets VERCEL_URL without a scheme, and that hostname sits behind
 * deployment protection, so production sets NEXT_PUBLIC_OFFICE_URL (the
 * same shape as NEXT_PUBLIC_STAFF_URL, docs/16). Locally the app is on
 * :3000.
 */
export function officeOrigin(): string {
  const explicit = process.env['NEXT_PUBLIC_OFFICE_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env['VERCEL_URL'];
  if (vercel) return `https://${vercel}`;
  return 'http://127.0.0.1:3000';
}
