'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { sessionIsAdmin } from '../../_lib/sessionRole';
import { supabaseConfigured } from '../data';
import { messageSentSummary, staffMessageRefusal } from './message';

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be sent. See docs/04-setup-github-vercel-supabase.md.';

interface RpcClient {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null } }> };
  rpc(
    fn: string,
    args?: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * Send push on /staff/:id (ADR-0081): the manager's own words to this one
 * worker, booked or not, as an OM2 push.
 *
 * Through the SESSION client, not the service key: send_staff_message() is
 * granted to `authenticated` and decides for itself — admin only, never a
 * viewer — and `auth.uid()` is then the manager its audit row names. The
 * admin check here is the first lock in front of it, because a server
 * action is a public POST endpoint.
 */
export async function messageWorker(
  staffId: string,
  message: string,
): Promise<
  { ok: false; message: string } | { ok: true; summary: string; everyoneReached: boolean }
> {
  if (!message.trim()) return { ok: false, message: staffMessageRefusal('message_required') };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in to do this.' };
  if (!(await sessionIsAdmin(supabase)))
    return { ok: false, message: 'Only the office can do this.' };

  const { data, error } = await supabase.rpc('send_staff_message', {
    p_staff: staffId,
    p_message: message,
  });
  if (error) {
    // PostgREST's "no function with these arguments": the database is
    // behind the app (the 29.09 lesson in the event board's messageLineUp).
    if (error.code === 'PGRST202' || /Could not find the function/.test(error.message))
      return {
        ok: false,
        message:
          'Messaging a worker from their profile is not switched on yet — the database update is still pending.',
      };
    return { ok: false, message: staffMessageRefusal(error.message) };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    sent?: number;
    withoutPush?: string[];
  };
  if (result.ok !== true)
    return { ok: false, message: staffMessageRefusal(String(result.reason ?? '')) };

  // The History tab shows the send (staff.message_sent).
  revalidatePath(`/staff/${staffId}`);
  const withoutPush = result.withoutPush ?? [];
  return {
    ok: true,
    summary: messageSentSummary(result.sent ?? 0, withoutPush),
    everyoneReached: withoutPush.length === 0,
  };
}
