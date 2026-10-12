'use server';

/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type (Views and Functions are Record<string, never>)
   until `pnpm --filter @thc/db gen:types` runs against a live project, so
   every view and RPC is typed `never`. The shapes are asserted instead by
   supabase/tests/160_client_portal.sql, which checks them against the real
   schema rather than against a stub. */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../../data';
import { feedbackErrorMessage } from '../../rules';

/**
 * §11.2 / §11.5 · leave feedback on one confirmed worker.
 *
 * Every rule lives in `submit_client_feedback()`, not here: who the booking
 * belongs to, whether the worker is on the confirmed line-up, whether the
 * event has started, and one entry per worker per event; since 12.10 also
 * a 2000-character comment cap, no feedback on a removed worker and none
 * on a cancelled event. This action checks the length itself (so a long
 * paste is answered without a round trip), carries the call, and turns a
 * Postgres error into a sentence.
 *
 * That split is deliberate. The screen disables the button before the event
 * starts, but a disabled button stops nobody — the RPC is what actually
 * refuses, and it runs with the caller's own session so the tenancy check
 * cannot be skipped by posting a different booking id.
 */
export type FeedbackResult = { ok: true } | { ok: false; error: string };

/** The comment cap the database holds too (20261012120000, feedback_text_len). */
const MAX_COMMENT = 2000;

const TOO_LONG = `Keep your comment to ${MAX_COMMENT} characters or fewer.`;
const WORKER_REMOVED =
  'This person is no longer on our books, so feedback can no longer be left for them.';

/**
 * The database's refusal in the customer's words. The two refusals
 * 20261012120000 added are recognised here; everything else goes through
 * feedbackErrorMessage (rules.ts). Never the raw text.
 */
function feedbackRefusal(error: { code?: string | null; message?: string | null }): string {
  const message = (error.message ?? '').toLowerCase();
  if (error.code === '22023' && message.includes('2000 characters')) return TOO_LONG;
  if (error.code === '22023' && message.includes('has been removed')) return WORKER_REMOVED;
  return feedbackErrorMessage(error);
}

export async function leaveFeedback(
  eventId: string,
  bookingId: string,
  rating: number,
  text: string,
): Promise<FeedbackResult> {
  if (!supabaseConfigured()) {
    return { ok: false, error: "The portal isn't connected yet. Please contact THC." };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Choose a rating between 1 and 5 stars.' };
  }

  const comment = typeof text === 'string' ? text.trim() : '';
  // Counted in code points, as Postgres char_length counts them.
  if ([...comment].length > MAX_COMMENT) return { ok: false, error: TOO_LONG };

  const supabase = createClient(await cookies()) as any;
  const { error } = await supabase.rpc('submit_client_feedback', {
    p_booking_id: bookingId,
    p_rating: rating,
    p_text: comment === '' ? null : comment,
  });

  if (error) {
    // The RPC's errors in the customer's words. 22023 covers a bad rating,
    // an event that has not started, an over-long comment and a removed
    // worker, so the message decides. The detail is for the server log.
    console.error('[feedback] refused', { code: error.code, message: error.message });
    return { ok: false, error: feedbackRefusal(error) };
  }

  // The button on this row becomes "✓ Feedback sent", which is a column of
  // client_lineup_v rather than screen state, so the page is re-read.
  revalidatePath(`/client/events/${eventId}`);
  return { ok: true };
}
