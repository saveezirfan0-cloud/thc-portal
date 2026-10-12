// Build-time fence (security.md Invariant 8): a cookie-backed session client
// belongs to server components, route handlers and middleware; Next refuses to
// bundle it into a Client Component. Browsers use `@thc/db/browser`.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import { withSessionPersistence } from './session';
import type { SessionFallback, SessionPersistence } from './session';
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
  /**
   * No preference on the device (an invite or reset link on a fresh device at
   * /auth/callback, a session from before ADR-0032). Left out, the app's
   * build-time default: 30 days in the Back Office and Client Portal, the
   * library's options in the Staff App (`defaultSessionFallback`).
   */
  fallback?: SessionFallback;
  /**
   * Write the auth cookies `httpOnly`. Opt-in, per app: only an app with NO
   * browser Supabase client may set it, or that client loses its session.
   * Left out, the app's build-time setting `THC_AUTH_COOKIE_HTTP_ONLY`
   * ('1' = on), which only the Client Portal sets (apps/client/next.config.ts);
   * the Back Office and Staff App keep @supabase/ssr's readable cookies.
   */
  httpOnly?: boolean;
}

/** The app's build-time opt-in, read as a literal so Next can inline it. */
export function defaultAuthCookiesHttpOnly(): boolean {
  return typeof process !== 'undefined' && process.env.THC_AUTH_COOKIE_HTTP_ONLY === '1';
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
  const httpOnly = options.httpOnly ?? defaultAuthCookiesHttpOnly();
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: withSessionPersistence(
      {
        getAll: () => cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options: cookieOptions } of toSet) {
            try {
              cookies.set(name, value, httpOnly ? { ...cookieOptions, httpOnly: true } : cookieOptions);
            } catch {
              // Called from a Server Component; middleware refreshes the session instead.
            }
          }
        },
      },
      { persistence: options.persistence, fallback: options.fallback },
    ),
  });
}
