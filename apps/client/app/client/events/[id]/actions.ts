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
import { isUuid } from '../../ids';
import {
  FEEDBACK_SIGNED_OUT,
  FEEDBACK_TOO_LONG,
  REQUEST_COPY,
  feedbackErrorMessage,
  feedbackTextTooLong,
  requestErrorMessage,
  requestNoteTooLong,
} from '../../rules';

/**
 * §11.2 / §11.5 · leave feedback on one confirmed worker.
 *
 * Every rule lives in `submit_client_feedback()`, not here: who the booking
 * belongs to, whether the worker is on the confirmed line-up, whether the
 * event has started, and one entry per worker per event; since 12.10 also
 * a 2000-character comment cap (20261012120600), no feedback on a removed
 * worker and none on a cancelled event (20261013100000). This action checks
 * the shape and the length itself (so a long paste is answered without a
 * round trip), carries the call, and turns a Postgres error into a
 * sentence.
 *
 * That split is deliberate. The screen disables the button before the event
 * starts, but a disabled button stops nobody — the RPC is what actually
 * refuses, and it runs with the caller's own session so the tenancy check
 * cannot be skipped by posting a different booking id.
 */
export type FeedbackResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** The session has lapsed: the modal keeps the comment and says "sign in again". */
      signedOut?: true;
    };

const WORKER_REMOVED =
  'This person is no longer on our books, so feedback can no longer be left for them.';

/**
 * The database's refusal in the customer's words. A removed worker
 * (20261013100000, §1.7) is recognised here; everything else — the rating,
 * an event not yet started, an over-long comment — goes through
 * feedbackErrorMessage (rules.ts). Never the raw text.
 */
function feedbackRefusal(error: { code?: string | null; message?: string | null }): string {
  const message = (error.message ?? '').toLowerCase();
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

  // A server action is a public endpoint: these arrive from whoever posts,
  // not only from the modal, so their shape is checked before anything runs.
  if (!isUuid(eventId) || !isUuid(bookingId)) {
    return { ok: false, error: 'That could not be saved.' };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Choose a rating between 1 and 5 stars.' };
  }

  if (typeof text !== 'string') return { ok: false, error: 'That could not be saved.' };
  // The textarea stops at the limit; the database refuses past it too.
  if (feedbackTextTooLong(text)) return { ok: false, error: FEEDBACK_TOO_LONG };
  const comment = text.trim();

  const supabase = createClient(await cookies()) as any;

  // No session: the RPC would refuse with a permission error that reads as
  // "not one of your events". Say what actually happened.
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: FEEDBACK_SIGNED_OUT, signedOut: true };

  const { error } = await supabase.rpc('submit_client_feedback', {
    p_booking_id: bookingId,
    p_rating: rating,
    p_text: comment === '' ? null : comment,
  });

  if (error) {
    // The database's own words go to the server log only.
    console.error('[client] submit_client_feedback refused', {
      code: error.code,
      message: error.message,
    });
    // The RPC's errors in the customer's words. 22023 covers a bad rating,
    // an event that has not started, an over-long comment and a removed
    // worker, so the message decides.
    return { ok: false, error: feedbackRefusal(error) };
  }

  // The button on this row becomes "✓ Feedback sent", which is a column of
  // client_lineup_v rather than screen state, so the page is re-read.
  revalidatePath(`/client/events/${eventId}`);
  return { ok: true };
}

export type RequestResult =
  | {
      ok: true;
      /** THC already had an open request for this person: nothing new was sent. */
      already: boolean;
    }
  | { ok: false; error: string; signedOut?: true };

/**
 * ADR-0135 §2 · "Request this person again" — a message to THC, never a
 * booking. Every rule is `client_request_worker()`'s: the booking on the
 * caller's visible line-up, the event finished and not cancelled, the worker
 * not removed, one open request per worker, 20 a day per company, and the
 * CP1 email to the office. This action checks the shape and the note's
 * length, carries the call under the caller's own session, and turns a
 * refusal into a sentence.
 */
export async function requestAgain(
  eventId: string,
  bookingId: string,
  note: string,
): Promise<RequestResult> {
  if (!supabaseConfigured()) {
    return { ok: false, error: "The portal isn't connected yet. Please contact THC." };
  }
  if (!isUuid(eventId) || !isUuid(bookingId) || typeof note !== 'string') {
    return { ok: false, error: REQUEST_COPY.failed };
  }
  const text = note.trim();
  if (requestNoteTooLong(text)) return { ok: false, error: REQUEST_COPY.tooLong };

  const supabase = createClient(await cookies()) as any;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: REQUEST_COPY.signedOut, signedOut: true };

  const { data, error } = await supabase.rpc('client_request_worker', {
    p_booking_id: bookingId,
    p_note: text === '' ? null : text,
  });
  if (error) {
    console.error('[client] client_request_worker refused', {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: requestErrorMessage(error) };
  }

  // "✓ Requested" is a column of client_lineup_v, so the page is re-read.
  revalidatePath(`/client/events/${eventId}`);
  revalidatePath('/client/feedback');
  return { ok: true, already: data?.already === true };
}
