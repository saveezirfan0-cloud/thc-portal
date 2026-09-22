'use server';

import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../db';

/**
 * Persisting a Web Push subscription — §10.5, §8.
 *
 * Both of these go through the definer functions in
 * 20260922181000_push_subscriptions.sql rather than writing the table:
 * the endpoint is unique and stable per browser, so the second launch of
 * the app is an upsert, and a shared phone has to re-point its endpoint to
 * whoever is signed in. RLS alone cannot express that in one statement.
 *
 * The endpoint is never logged. It is a bearer capability to send that
 * device a notification, so it is treated like a credential: the error
 * path below says what failed, never with what value.
 */

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  replaces?: string;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function savePushSubscription(input: SubscriptionInput): Promise<SaveResult> {
  if (!supabaseConfigured()) {
    // No project wired up (docs/04). Say so rather than returning ok and
    // leaving a worker believing they are reachable.
    return { ok: false, error: 'This environment has no database, so nothing was saved.' };
  }
  if (!input?.endpoint || !input.p256dh || !input.auth) {
    return { ok: false, error: 'The browser returned an incomplete subscription.' };
  }

  const supabase = staffDb(await cookies());
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent.slice(0, 200),
    p_replaces: input.replaces ?? null,
  });

  if (error) {
    console.error('[push] subscription not saved', { code: error.code, message: error.message });
    return {
      ok: false,
      error:
        error.message === 'account_closed'
          ? 'This account has left The Hospitality Company, so notifications are off.'
          : 'We could not register this device for notifications. Try again from the app.',
    };
  }
  return { ok: true };
}

export async function forgetPushSubscription(endpoint: string): Promise<SaveResult> {
  if (!supabaseConfigured()) return { ok: false, error: 'No database in this environment.' };
  const supabase = staffDb(await cookies());
  const { error } = await supabase.rpc('forget_push_subscription', { p_endpoint: endpoint });
  if (error) {
    console.error('[push] subscription not removed', { code: error.code, message: error.message });
    return { ok: false, error: 'We could not turn notifications off for this device.' };
  }
  return { ok: true };
}
