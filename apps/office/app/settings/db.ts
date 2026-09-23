import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import type { CookieStore } from '@thc/db/server';

/**
 * A Supabase client for /settings' writes.
 *
 * Same narrowing as `apps/office/app/events/db.ts`, for the same reason:
 * `packages/db` still ships the PLACEHOLDER `Database` type, so an
 * `upsert` into `settings` or an `update` on `venue_types` resolves to
 * `never` and nothing here compiles. The reads next door do not need it —
 * they declare their row shape with `.returns<T>()` — but a write has no
 * equivalent escape hatch.
 *
 * Delete this when `pnpm --filter @thc/db gen:types` has run against a
 * linked project.
 */
export function settingsDb(cookies: CookieStore): SupabaseClient {
  return createClient(cookies) as unknown as SupabaseClient;
}
