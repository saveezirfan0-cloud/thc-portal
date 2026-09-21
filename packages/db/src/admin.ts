import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabaseServiceRoleKey, supabaseUrl } from './env';
import type { Database } from './types.generated';

/**
 * Service-role client. BYPASSES RLS.
 *
 * Server-side only, and only for work that genuinely has no user session:
 * invite links (§2.7), background jobs, webhook handlers. Never import this
 * from a client component or a shared module an app bundles.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never run in the browser.');
  }
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
