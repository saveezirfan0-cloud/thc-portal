// Build-time fence (security.md Invariant 8): Next refuses to bundle this
// module into a Client Component, so the service-role key can never reach a
// browser bundle. The `window` check below is the runtime belt to this brace.
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabaseServiceRoleKey, supabaseUrl } from './env';
import { createRequestTimeoutFetch } from './request-timeout';
import type { RequestTimeoutOptions } from './request-timeout';
import type { Database } from './types.generated';

/**
 * Service-role client. BYPASSES RLS.
 *
 * Server-side only, and only for work that genuinely has no user session:
 * invite links (§2.7), background jobs, webhook handlers. Never import this
 * from a client component or a shared module an app bundles.
 */
export interface AdminClientOptions {
  /**
   * Request timeouts (ADR-0154, packages/db/src/request-timeout.ts). Left
   * out, PostgREST and GoTrue reads (GET/HEAD) are aborted after 10 s;
   * writes, RPCs over POST, Storage and Functions are never aborted unless
   * an RPC is listed in `readOnlyRpcs`. `false` turns timeouts off.
   */
  requestTimeout?: RequestTimeoutOptions | false;
}

export function createAdminClient(options: AdminClientOptions = {}) {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never run in the browser.');
  }
  const timeouts = options.requestTimeout ?? {};
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(timeouts === false ? {} : { global: { fetch: createRequestTimeoutFetch(timeouts) } }),
  });
}
