/**
 * Where sign-in lands (§1.4). `next` is honoured only as a path on THIS
 * origin, never as a host.
 *
 * `startsWith('/')` was the whole guard, and it is not one: `//evil.com`
 * and `/\evil.com` both start with a slash, and both resolve — under the
 * WHATWG URL parser every browser uses, where a backslash in an http URL
 * is a slash — to https://evil.com/. A manager who has just typed their
 * password into the genuine THC domain would be delivered to an attacker's
 * page, and a `/login?next=` link in an email is exactly that kit.
 *
 * The rule: parse `next` against a throwaway origin and keep it only if it
 * stayed on that origin, began with a single `/`, and carries no backslash
 * in any spelling. Everything else — an absolute URL, a scheme, a
 * protocol-relative host, a relative segment — falls back to the app's own
 * landing route.
 *
 * Same helper as apps/staff/app/login/safeNext.ts; the three apps should
 * share one copy from packages/db once that package takes it.
 */
const PROBE_ORIGIN = 'http://thc.invalid';

export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!/^\/(?![/\\])/.test(next)) return fallback;
  // A backslash, raw or percent-encoded, is never part of a route here.
  if (/\\|%5c/i.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return url.pathname + url.search + url.hash;
}
