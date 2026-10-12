import type { SupabaseClient } from '@supabase/supabase-js';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';

/**
 * The server-side half of "admin only" for the /events actions.
 *
 * Every write these actions make already lands on a database function that
 * refuses a non-admin (`office_invite_worker`, `withdraw_booking`, … raise
 * `not_authorised`). This is the second lock, in front of it: a server
 * action is a public POST endpoint, so a signed-in worker or client who
 * finds its id reaches the action before the database — and the answer
 * they get should be a refusal from here, not whatever the RPC's error
 * text happens to be (audit 25.09, claim 2b).
 *
 * Every caller WRITES, so the question asked is `office_can('write')`
 * (ADR-0060): false for a viewer, and false for any session
 * `current_app_role()` does not answer 'admin' for — a switched-off login,
 * a two-step login below aal2. Not `profiles.role`, which says 'admin' for
 * all of those. `auth.getUser()` verifies the token with Supabase first;
 * nothing the browser sent is trusted.
 */
export const NOT_ADMIN = 'Only the office can do this.';
export const SIGNED_OUT = 'Sign in to do this.';
export const READ_ONLY = READ_ONLY_MESSAGE;

export async function adminRefusal(supabase: SupabaseClient): Promise<string | null> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) return SIGNED_OUT;
  if (await officeMayWrite(supabase)) return null;
  // Only to word the refusal: the office reading, or not the office at all.
  return (await sessionIsAdmin(supabase)) ? READ_ONLY : NOT_ADMIN;
}
