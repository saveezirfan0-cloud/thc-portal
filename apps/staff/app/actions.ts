'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ACCEPT_REFUSAL_COPY,
  APPLY_REFUSAL_COPY,
  type AcceptRefusal,
  type ApplyRefusal,
} from '@thc/domain';
import { staffDb, supabaseConfigured } from './db';
import {
  COVER_REFUSAL_COPY,
  OFFER_REFUSAL_COPY,
  takeRefusalCopy,
  withdrawOfferRefusalCopy,
} from './shifts/offers';

/**
 * The five things a worker can press — Scope §10.4.
 *
 * Every one of them is a single RPC. The rules they enforce (first-to-confirm,
 * the overlap safety net, the RULE-20 cap, the 72-hour cancel window, the
 * live availability re-check) live in the database, because the app is a
 * phone on a train and the office board is looking at the same rows. What
 * comes back here is a reason code; what this file adds is the sentence the
 * scope puts in front of the worker for it.
 */

export interface Refusal {
  title: string;
  body: string;
}
export type ActionResult = { ok: true; note?: string } | { refusal: Refusal };

const NO_SUPABASE: Refusal = {
  title: 'Not connected',
  body: 'This environment has no Supabase project, so nothing can be changed (docs/04-setup-github-vercel-supabase.md).',
};

const UNKNOWN: Refusal = {
  title: 'That didn’t go through',
  body: 'Please try again. If it keeps happening, contact the office.',
};

async function db() {
  return staffDb(await cookies());
}

function refresh() {
  revalidatePath('/shifts');
  revalidatePath('/invites');
  revalidatePath('/radar');
}

type Rpc = Record<string, unknown> | null;

/** Accept an invitation (§3.4, §3.5 stage 1). First to confirm takes the slot. */
export async function acceptInvite(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('accept_invite', { p_booking: bookingId });
  if (error) {
    // The one refusal the RPC raises rather than returns: the event went
    // while the screen was open.
    if (error.message.includes('event_cancelled')) {
      return { refusal: ACCEPT_REFUSAL_COPY.event_cancelled };
    }
    return { refusal: UNKNOWN };
  }
  const result = data as Rpc;
  if (result?.['ok'] === true) {
    refresh();
    const withdrawn = Number(result['withdrawn'] ?? 0);
    return {
      ok: true,
      // §3.4: accepting auto-withdraws every other open invitation whose
      // window overlaps. Saying so is the difference between a worker
      // thinking the list is broken and knowing why it got shorter.
      ...(withdrawn > 0
        ? {
            note: `${withdrawn} overlapping ${withdrawn === 1 ? 'invitation was' : 'invitations were'} withdrawn automatically.`,
          }
        : {}),
    };
  }
  const reason = String(result?.['reason'] ?? '');
  refresh();
  return { refusal: ACCEPT_REFUSAL_COPY[reason as AcceptRefusal] ?? UNKNOWN };
}

/** Decline (§10.4). Always available, no show-rate impact. */
export async function declineInvite(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('decline_invite', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refresh();
  return (data as Rpc)?.['ok'] === true ? { ok: true } : { refusal: UNKNOWN };
}

/** Stage 2 (§3.5): "I'm ready for tomorrow", by 12:00 UK. The hard one. */
export async function markReady(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('mark_ready', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refresh();
  if ((data as Rpc)?.['reason'] === 'deadline_passed')
    return {
      refusal: {
        title: 'The 12:00 deadline has passed',
        body: '“I’m ready” closes at 12:00 (UK time) the day before the shift. Check your notifications, or contact the office.',
      },
    };
  return (data as Rpc)?.['ok'] === true
    ? { ok: true }
    : {
        refusal: {
          title: 'This shift is no longer yours to confirm',
          body: 'It may have been released at the 12:00 deadline, or withdrawn by the office. Check your notifications.',
        },
      };
}

/** Stage 3 (§3.5): the on-the-day confirmation. A reminder, never a deadline. */
export async function confirmToday(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('confirm_on_day', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refresh();
  return (data as Rpc)?.['ok'] === true ? { ok: true } : { refusal: UNKNOWN };
}

/** "Confirm new time" after N11 (§3.5). */
export async function reconfirm(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('reconfirm_booking', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refresh();
  return (data as Rpc)?.['ok'] === true ? { ok: true } : { refusal: UNKNOWN };
}

/**
 * Cancel shift (RULE-04, §3.6). Only while more than 72 hours remain, and
 * permanently removes this EVENT from the worker's reach — which is why the
 * dialog in front of it says so in as many words.
 */
export async function cancelShift(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('self_cancel_booking', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  const result = data as Rpc;
  if (result?.['ok'] === true) {
    refresh();
    return { ok: true };
  }
  refresh();
  return result?.['reason'] === 'too_late'
    ? {
        refusal: {
          title: 'Too close to the shift to cancel',
          body: 'Cancelling in the app closes 72 hours before the start. Contact the office — don’t just not turn up.',
        },
      }
    : { refusal: UNKNOWN };
}

/** Radar self-apply (§10.4). Re-checks live availability before recording. */
export async function applyForShift(shiftId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('apply_to_shift', { p_shift: shiftId });
  if (error) return { refusal: UNKNOWN };
  const result = data as Rpc;
  refresh();
  if (result?.['ok'] === true) return { ok: true };
  const reason = String(result?.['reason'] ?? '');
  return { refusal: APPLY_REFUSAL_COPY[reason as ApplyRefusal] ?? UNKNOWN };
}

/** Withdraw a pending application (§10.4). Never sets the RULE-04 bar. */
export async function withdrawApplication(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await db();
  const { data, error } = await supabase.rpc('withdraw_application', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refresh();
  return (data as Rpc)?.['ok'] === true ? { ok: true } : { refusal: UNKNOWN };
}

// ---------------------------------------------------------------------
// Offer up a shift — ADR-0046, docs/19 §4
// ---------------------------------------------------------------------

/**
 * The offer RPCs (20260930201100), typed locally until the Phase 2 type
 * regeneration (docs/19 §8) — the `(supabase as unknown as XRpc)` pattern.
 */
interface OfferRpc {
  rpc(
    fn: 'offer_shift' | 'withdraw_shift_offer' | 'request_cover' | 'take_offered_shift',
    args: Record<string, string | null>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function offerDb(): Promise<OfferRpc> {
  return (await db()) as unknown as OfferRpc;
}

function refreshOffer(bookingId?: string) {
  refresh();
  if (bookingId) revalidatePath(`/shifts/${bookingId}`);
}

/**
 * Offer this shift (> 72 h out, auto-assign on). The worker stays booked
 * until somebody takes it; the dialog in front of the button says so, and
 * that taking it bars them from this event.
 */
export async function offerShift(bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await offerDb();
  const { data, error } = await supabase.rpc('offer_shift', { p_booking: bookingId });
  if (error) return { refusal: UNKNOWN };
  refreshOffer(bookingId);
  const result = data as Rpc;
  if (result?.['ok'] === true) return { ok: true };
  return { refusal: OFFER_REFUSAL_COPY[String(result?.['reason'] ?? '')] ?? UNKNOWN };
}

/** Withdraw offer — the shift stays the worker's, as it always was. */
export async function withdrawShiftOffer(
  offerId: string,
  bookingId: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await offerDb();
  const { data, error } = await supabase.rpc('withdraw_shift_offer', { p_offer: offerId });
  if (error) return { refusal: UNKNOWN };
  refreshOffer(bookingId);
  const result = data as Rpc;
  if (result?.['ok'] === true) return { ok: true };
  return { refusal: withdrawOfferRefusalCopy() };
}

/**
 * Ask the office for cover (inside 72 h, or auto-assign off). The office is
 * emailed at once (OF5); the worker is still booked until it acts.
 */
export async function requestCover(bookingId: string, note: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await offerDb();
  const trimmed = note.trim();
  const { data, error } = await supabase.rpc('request_cover', {
    p_booking: bookingId,
    p_note: trimmed === '' ? null : trimmed,
  });
  if (error) return { refusal: UNKNOWN };
  refreshOffer(bookingId);
  const result = data as Rpc;
  if (result?.['ok'] === true) return { ok: true };
  return { refusal: COVER_REFUSAL_COPY[String(result?.['reason'] ?? '')] ?? UNKNOWN };
}

/**
 * Take this shift (`/radar/offers/:id`). A confirmed booking at once — not
 * an application — so a success goes straight to the shift. Every refusal
 * reuses Radar's own words (wireframes/staff/offer-shift.html (j)).
 */
export async function takeOfferedShift(offerId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { refusal: NO_SUPABASE };
  const supabase = await offerDb();
  const { data, error } = await supabase.rpc('take_offered_shift', { p_offer: offerId });
  if (error) {
    // The rota guard is the backstop underneath the gates.
    const guard = /rota_guard_(rtw_expired|visa_cap|wtr_cap)/.exec(error.message)?.[1];
    if (guard) {
      return {
        refusal:
          takeRefusalCopy(guard === 'rtw_expired' ? 'rtw_expired' : 'hours_limit') ?? UNKNOWN,
      };
    }
    return { refusal: UNKNOWN };
  }
  refresh();
  const result = data as Rpc;
  if (result?.['ok'] === true && typeof result['bookingId'] === 'string') {
    redirect(`/shifts/${result['bookingId']}`);
  }
  return { refusal: takeRefusalCopy(String(result?.['reason'] ?? '')) ?? UNKNOWN };
}
