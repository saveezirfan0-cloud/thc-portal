import { createBrowserClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import { isSessionOnly, parseCookieHeader, serializeCookie, sessionCookieOptions } from './session';
import type { Database } from './types.generated';

/**
 * Anon-key client for client components. RLS does the enforcing.
 *
 * The cookie methods are @supabase/ssr's own document.cookie behaviour with
 * one change: a token refresh in the browser keeps "Keep me signed in"
 * unticked as unticked (session cookies), rather than rewriting the auth
 * cookies with a 400-day Max-Age (ADR-0035, ./session.ts).
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      // No `document` while a client component is pre-rendered on the
      // server: nothing to read, and nothing to write (as @supabase/ssr).
      getAll: () => (typeof document === 'undefined' ? [] : parseCookieHeader(document.cookie)),
      setAll: (toSet) => {
        if (typeof document === 'undefined') return;
        const sessionOnly = isSessionOnly(parseCookieHeader(document.cookie));
        for (const { name, value, options } of toSet) {
          document.cookie = serializeCookie(
            name,
            value,
            sessionCookieOptions(options, sessionOnly) ?? {},
          );
        }
      },
    },
  });
}
