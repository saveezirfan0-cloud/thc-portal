// Build-time fence (security.md Invariant 8): a cookie-backed session client
// belongs to server components, route handlers and middleware; Next refuses to
// bundle it into a Client Component. Browsers use `@thc/db/browser`.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';
import type { Database } from './types.generated';

export interface CookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

/**
 * Anon-key client for server components, route handlers and middleware.
 * Still subject to RLS — this is the user's session, not an escalation.
 */
export function createClient(cookies: CookieStore) {
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          try {
            cookies.set(name, value, options);
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        }
      },
    },
  });
}
