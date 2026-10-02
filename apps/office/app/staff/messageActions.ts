'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { sessionIsAdmin } from '../_lib/sessionRole';
import { supabaseConfigured } from './data';
import { MAX_RECIPIENTS, messageSentSummary, staffMessageRefusal } from './message';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be sent. See docs/04-setup-github-vercel-supabase.md.';

interface RpcClient {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null } }> };
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * Send push (ADR-0082): the manager's own words to hand-picked workers — one
 * from their profile, or the ones ticked in the directory — booked or not,
 * as one OM2 push each.
 *
 * Through the SESSION client, not the service key: send_staff_message() is
 * granted to `authenticated` and decides for itself — admin only, never a
 * viewer, never a removed worker — and `auth.uid()` is then the manager its
 * audit rows name. The admin check here is the first lock in front of it,
 * because a server action is a public POST endpoint.
 */
export async function messageStaff(
  staffIds: readonly string[],
  message: string,
): Promise<
  { ok: false; message: string } | { ok: true; summary: string; everyoneReached: boolean }
> {
  if (!message.trim()) return { ok: false, message: staffMessageRefusal('message_required') };
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return { ok: false, message: staffMessageRefusal('nobody_to_message') };
  if (ids.length > MAX_RECIPIENTS)
    return { ok: false, message: staffMessageRefusal('too_many_recipients') };
  // A server action is a public endpoint: anything but ids is refused here,
  // not passed on to come back as Postgres's uuid syntax error.
  if (!ids.every((id) => UUID.test(id)))
    return { ok: false, message: staffMessageRefusal('staff_not_found') };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in to do this.' };
  if (!(await sessionIsAdmin(supabase)))
    return { ok: false, message: 'Only the office can do this.' };

  const { data, error } = await supabase.rpc('send_staff_message', {
    p_staff: ids,
    p_message: message,
  });
  if (error) {
    // PostgREST's "no function with these arguments": the database is
    // behind the app (the 29.09 lesson in the event board's messageLineUp).
    if (error.code === 'PGRST202' || /Could not find the function/.test(error.message))
      return {
        ok: false,
        message:
          'Sending a push to chosen workers is not switched on yet — the database update is still pending.',
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

  // Each profile's History tab shows the send (staff.message_sent).
  for (const id of ids) revalidatePath(`/staff/${id}`);
  const withoutPush = result.withoutPush ?? [];
  return {
    ok: true,
    summary: messageSentSummary(result.sent ?? 0, withoutPush),
    everyoneReached: withoutPush.length === 0,
  };
}
