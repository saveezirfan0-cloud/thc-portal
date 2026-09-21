import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import type { CookieStore } from '@thc/db/server';

/**
 * A Supabase client for the /events screens.
 *
 * `packages/db` still ships the PLACEHOLDER `Database` type — `Tables` is an
 * empty record until `pnpm --filter @thc/db gen:types` has run against a
 * linked project — so every `from('events')` resolves to `never` and nothing
 * here would compile. This narrows to the untyped client and the callers
 * declare the row shapes they read, which is what the generated types will
 * assert once they exist. Delete this file when they do.
 */
export function eventsDb(cookies: CookieStore): SupabaseClient {
  return createClient(cookies) as unknown as SupabaseClient;
}

/** True when this environment has a Supabase project wired up (docs/04). */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}
