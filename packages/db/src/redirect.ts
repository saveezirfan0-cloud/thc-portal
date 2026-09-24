/**
 * The one place a `next` parameter is turned into somewhere to go (§1.4).
 *
 * Every app honours `?next=` after sign-in, and the Staff App honours it on
 * the end of an emailed link (/auth/callback). Each used to write its own
 * check, `next.startsWith('/')`, which is exactly the check that lets
 * `//evil.example` (a protocol-relative URL) and `/\evil.example` (browsers
 * read a backslash as a slash) leave the site. An open redirect on the end
 * of a genuine THC email or sign-in page is a phishing kit: the mail and the
 * login form are real, and the page after them would not be.
 *
 * So the rule is an allow-list, not a pattern: a relative path on this
 * origin, and nothing else.
 *
 *   - a string that starts with exactly one `/`;
 *   - no backslash anywhere (`/\`, `/x\..\` and friends are all host tricks);
 *   - no control character or whitespace (browsers strip tab/CR/LF from a
 *     URL, which turns `/\t/evil.example` into `//evil.example` after the
 *     check has passed);
 *   - and, as the final word rather than the only one, resolving it against
 *     the origin must land on that same origin.
 *
 * What comes back is the resolved path + query + hash, never the raw input,
 * so `/a/../b` arrives as `/b` and nothing downstream re-parses the original.
 */

/** Any origin works for the resolution check; this one can never be real. */
const PROBE_ORIGIN = 'https://redirect-probe.invalid';

/** Long enough for any real deep link, short enough not to be a payload. */
const MAX_LENGTH = 2048;

// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const UNSAFE_CHARS = /[\u0000-\u0020\u007f-\u009f\\\u2028\u2029]/;

/**
 * The same-origin path `next` names, or null when it names anything else.
 *
 * `origin` is the origin the redirect will be resolved against. It is
 * optional because a server action does not always have one to hand; the
 * check is the same either way, since a relative path that stays on one
 * origin stays on every origin.
 */
export function safeRelativePath(next: unknown, origin: string = PROBE_ORIGIN): string | null {
  if (typeof next !== 'string') return null;
  if (next.length === 0 || next.length > MAX_LENGTH) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  if (UNSAFE_CHARS.test(next)) return null;

  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(next, base.origin);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;

  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  // Belt and braces: the normalised form must still be a plain path.
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path;
}

/** True when `next` is a same-origin relative path. */
export function isSafeRelativePath(next: unknown, origin?: string): next is string {
  return safeRelativePath(next, origin) !== null;
}

/**
 * Where to send someone: `next` when it is safe, otherwise `fallback`.
 *
 * The fallback is a constant in each caller (`/dashboard`, `/shifts`, …),
 * but it goes through the same check so a mistyped one fails loudly in the
 * tests rather than quietly becoming the hole this closes.
 */
export function safeNextPath(next: unknown, fallback: string, origin?: string): string {
  const safe = safeRelativePath(next, origin);
  if (safe !== null) return safe;
  const home = safeRelativePath(fallback, origin);
  if (home === null)
    throw new Error(`safeNextPath: fallback ${JSON.stringify(fallback)} is not a relative path`);
  return home;
}
