import type { SupabaseClient } from '@supabase/supabase-js';

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
 * The role is read through the caller's OWN session: `auth.getUser()`
 * verifies the token with Supabase, and `profiles` answers under its own
 * policy. Nothing the browser sent is trusted.
 */
export const NOT_ADMIN = 'Only the office can do this.';
export const SIGNED_OUT = 'Sign in to do this.';

export async function adminRefusal(supabase: SupabaseClient): Promise<string | null> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) return SIGNED_OUT;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .maybeSingle<{ role: string }>();
  return profile?.role === 'admin' ? null : NOT_ADMIN;
}
