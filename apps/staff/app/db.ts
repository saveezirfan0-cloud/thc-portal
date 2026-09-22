import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import type { CookieStore } from '@thc/db/server';

/**
 * A Supabase client for the Staff App's working screens.
 *
 * Same narrowing as `apps/office/app/events/db.ts`, for the same reason:
 * `packages/db` still ships the PLACEHOLDER `Database` type, so every typed
 * call resolves to `never`. The screens declare the row shapes they read —
 * which is what `pnpm --filter @thc/db gen:types` will assert once a project
 * is linked. Delete this file when it does.
 */
export function staffDb(cookies: CookieStore): SupabaseClient {
  return createClient(cookies) as unknown as SupabaseClient;
}

/** True when this environment has a Supabase project wired up (docs/04). */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}
