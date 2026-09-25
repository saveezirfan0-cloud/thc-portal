// Build-time fence (security.md Invariant 8): a cookie-backed session client
// belongs to server components, route handlers and middleware; Next refuses to
// bundle it into a Client Component. Browsers use `@thc/db/browser`.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import { isSessionOnly, sessionCookieOptions } from './session';
import type { Database } from './types.generated';

export interface CookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

export interface ClientOptions {
  /**
   * "Keep me signed in on this device" unticked (ADR-0035): write the auth
   * cookies as session cookies. Omitted, it follows the marker cookie the
   * sign-in left, so a token refresh keeps whatever the user chose.
   */
  sessionOnly?: boolean;
}

/**
 * Anon-key client for server components, route handlers and middleware.
 * Still subject to RLS — this is the user's session, not an escalation.
 */
export function createClient(cookies: CookieStore, opts: ClientOptions = {}) {
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => {
        const sessionOnly = opts.sessionOnly ?? isSessionOnly(cookies.getAll());
        for (const { name, value, options } of toSet) {
          try {
            cookies.set(name, value, sessionCookieOptions(options, sessionOnly));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        }
      },
    },
  });
}
