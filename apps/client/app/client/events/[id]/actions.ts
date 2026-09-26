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
 * event has started, and one entry per worker per event. This action only
 * carries the call and turns a Postgres error into a sentence.
 *
 * That split is deliberate. The screen disables the button before the event
 * starts, but a disabled button stops nobody — the RPC is what actually
 * refuses, and it runs with the caller's own session so the tenancy check
 * cannot be skipped by posting a different booking id.
 */
export type FeedbackResult = { ok: true } | { ok: false; error: string };

export async function leaveFeedback(
  eventId: string,
  bookingId: string,
  rating: number,
  text: string,
): Promise<FeedbackResult> {
  if (!supabaseConfigured()) {
    return { ok: false, error: 'This environment has no Supabase project, so nothing was saved.' };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Choose a rating between 1 and 5 stars.' };
  }

  const supabase = createClient(await cookies()) as any;
  const { error } = await supabase.rpc('submit_client_feedback', {
    p_booking_id: bookingId,
    p_rating: rating,
    p_text: text.trim() === '' ? null : text.trim(),
  });

  if (error) {
    // The RPC's errors in the customer's words. 22023 covers both a bad
    // rating and an event that has not started, so the message decides.
    return { ok: false, error: feedbackErrorMessage(error) };
  }

  // The button on this row becomes "✓ Feedback sent", which is a column of
  // client_lineup_v rather than screen state, so the page is re-read.
  revalidatePath(`/client/events/${eventId}`);
  return { ok: true };
}
