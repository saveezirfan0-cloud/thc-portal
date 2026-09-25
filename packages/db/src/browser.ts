import { createBrowserClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import { withSessionPersistence } from './session';
import type { CookieToSet } from './session';
import type { Database } from './types.generated';

/**
 * Anon-key client for client components. RLS does the enforcing.
 *
 * The cookie methods are spelled out, rather than left to `@supabase/ssr`'s
 * built-in `document.cookie` adapter, for one reason: a page left open (the
 * check-in monitor runs all shift) refreshes its token from JavaScript, and
 * the built-in adapter would write the auth cookies back with a 400-day
 * `Max-Age`, undoing an unticked "Keep me signed in" (ADR-0032). These go
 * through the same `withSessionPersistence` as the server and middleware.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: withSessionPersistence({ getAll: readDocumentCookies, setAll: writeDocumentCookies }),
  });
}

/** `document.cookie` as name/value pairs; nothing outside a browser. */
export function readDocumentCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined' || !document.cookie) return [];
  return document.cookie.split(/;\s*/).flatMap((pair) => {
    const eq = pair.indexOf('=');
    if (eq <= 0) return [];
    const name = pair.slice(0, eq).trim();
    const raw = pair
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    return [{ name, value: safeDecode(raw) }];
  });
}

function writeDocumentCookies(toSet: CookieToSet[]): void {
  if (typeof document === 'undefined') return;
  for (const { name, value, options } of toSet) {
    document.cookie = serializeCookie(name, value, options);
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function titleCase(value: string): string {
  const lower = value.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}

/**
 * One cookie string for `document.cookie`, encoding the value the way the
 * `cookie` package (and so `@supabase/ssr`'s own adapter) does. No `Max-Age`
 * and no `Expires` makes a session cookie, which is the point.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.secure) parts.push('Secure');
  if (options.partitioned) parts.push('Partitioned');
  if (options.priority) parts.push(`Priority=${titleCase(String(options.priority))}`);
  if (options.sameSite) {
    parts.push(
      `SameSite=${titleCase(options.sameSite === true ? 'strict' : String(options.sameSite))}`,
    );
  }
  return parts.join('; ');
}
