// Build-time fence (security.md Invariant 8): a cookie-backed session client
// belongs to server components, route handlers and middleware; Next refuses to
// bundle it into a Client Component. Browsers use `@thc/db/browser`.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import { withSessionPersistence } from './session';
import type { SessionPersistence } from './session';
import type { Database } from './types.generated';

export interface CookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

export interface CreateClientOptions {
  /**
   * "Keep me signed in" for THIS request's auth-cookie writes (ADR-0032).
   * Only the login action passes it — the box's value, which the cookies do
   * not carry yet. Everyone else leaves it out and the device's remembered
   * choice (`thc-keep-signed-in`) is read from the cookies.
   */
  persistence?: SessionPersistence;
}

/**
 * Anon-key client for server components, route handlers and middleware.
 * Still subject to RLS — this is the user's session, not an escalation.
 *
 * Every auth-cookie write it makes (sign-in, code exchange, token refresh,
 * sign-out) goes through `withSessionPersistence`, so a "session only"
 * sign-in is never quietly made persistent again (packages/db/src/session.ts).
 */
export function createClient(cookies: CookieStore, options: CreateClientOptions = {}) {
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: withSessionPersistence(
      {
        getAll: () => cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options: cookieOptions } of toSet) {
            try {
              cookies.set(name, value, cookieOptions);
            } catch {
              // Called from a Server Component; middleware refreshes the session instead.
            }
          }
        },
      },
      options.persistence,
    ),
  });
}
