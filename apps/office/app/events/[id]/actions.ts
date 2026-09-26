'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { acceptApplicationRefusal, cancelEventRefusal, payrollWarning } from '@thc/domain';
import { adminRefusal } from '../admin';
import { eventsDb, supabaseConfigured } from '../db';
import { inviteRefusal, offerOfficeRefusal, withdrawRefusal } from './board-model';

export type ActionResult = { error: string } | { ok: true; warning?: string };

const NO_SUPABASE =
  'This environment has no Supabase project, so the board cannot be changed (docs/04-setup-github-vercel-supabase.md).';

/**
 * The manager's actions on the event board — Scope §3.3.
 *
 * There is deliberately no Confirm here: the WORKER confirms, in the app.
 * The manager can only invite from the Potential pool, withdraw, record a
 * no-show, undo one, take a Radar application forward (the applicant
 * already said yes — §3.3, N10), switch auto-assign off and on, or cancel
 * the whole event.
 */

async function db() {
  return eventsDb(await cookies());
}

/**
 * Withdraw removes a worker from the shift (§3.3). An invitation withdrawn
 * and a confirmation withdrawn are the same transition — `cancelled`,
 * cause `office_withdraw` — so the slot reopens and auto-assign can top it
 * up (§3.6).
 *
 * One RPC, `withdraw_booking()` (20260930110300). It decides from the row
 * itself, under the section lock, and queues the push in the same
 * transaction: N10b for a confirmed worker, N10d for an invitee. This used
 * to be a direct UPDATE plus a second call keyed on a `wasConfirmed` flag
 * the page supplied — a stale page withdrew a worker who had just
 * confirmed without telling them, and a failed second call told nobody
 * (audit D38).
 */
export async function withdraw(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();
  const refused = await adminRefusal(supabase);
  if (refused) return { error: refused };

  const { data, error } = await supabase.rpc('withdraw_booking', { p_booking: bookingId });
  if (error) {
    if (/booking_not_found/.test(error.message)) return { error: 'That booking no longer exists.' };
    return { error: `The worker was not withdrawn: ${error.message}` };
  }
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  revalidatePath(`/events/${eventId}`);
  if (result.ok !== true) return { error: withdrawRefusal(String(result.reason ?? '')) };
  return { ok: true };
}

/**
 * §3.3. Marking a no-show by hand, for the cases the automatic 30-minute
 * check does not cover. The worker stays in Confirmed, badged — this writes
 * the violation, it does not move them.
 *
 * One RPC, `office_mark_no_show()` (20260928110200): admin only, locked on
 * the booking; confirmed with no check-in, inside the §3.3 window (the same
 * one `canMarkNoShow` shows), one open no-show per booking. This used to
 * insert straight into `violations` from here with none of those guards.
 */
export async function markNoShow(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data, error } = await supabase.rpc('office_mark_no_show', { p_booking: bookingId });
  if (error) return { error: noShowRefusal(error.message) };
  const result = (data ?? {}) as { ok?: boolean; payrollExported?: boolean };
  if (result.ok !== true) return { error: 'The no-show was not recorded.' };

  revalidatePath(`/events/${eventId}`);
  // The money is corrected in THC's own finance process, outside the app.
  return {
    ok: true,
    warning: payrollWarning('no_show', Boolean(result.payrollExported)) ?? undefined,
  };
}

/**
 * §3.3. "Get back" registers the worker as arrived and reclassifies them
 * from No-show to Late, with minutes-late measured from the moment the
 * manager pressed it. It is the only way back in once the check-in button
 * has locked.
 *
 * One RPC, `get_back()` (20260928110200), which finds the booking's open
 * no-show and delegates to `resolve_violation()` — the Violation log's
 * Resolve on the same entry (§9.5). That is what writes the check-in at the
 * press, moves the booking to `worked` and reclassifies the violation in
 * place. This used to delete the no-show and insert a `late` row from here,
 * which left the booking without a check-in and payable_shifts_v paying 0.
 */
export async function getBack(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data, error } = await supabase.rpc('get_back', { p_booking: bookingId });
  if (error) return { error: getBackRefusal(error.message) };
  const result = (data ?? {}) as { decision?: string; payrollExported?: boolean };
  if (result.decision === 'already_resolved') {
    return { error: 'This no-show has already been resolved.' };
  }
  if (result.decision !== 'resolved') return { error: 'The worker was not got back.' };

  revalidatePath(`/events/${eventId}`);
  return {
    ok: true,
    warning: payrollWarning('get_back', Boolean(result.payrollExported)) ?? undefined,
  };
}

/** What each refusal from `office_mark_no_show()` means to the manager. */
function noShowRefusal(raw: string): string {
  if (/admins_only/.test(raw)) return 'Only the office can record a no-show.';
  if (/booking_not_found/.test(raw)) return 'That booking no longer exists.';
  if (/booking_not_confirmed/.test(raw)) {
    return 'Only a confirmed worker can be marked as a no-show.';
  }
  if (/already_checked_in/.test(raw))
    return 'This worker has checked in, so they are not a no-show.';
  if (/outside_window/.test(raw)) {
    return 'No-show can be recorded from the shift start until two weeks after it ends.';
  }
  return raw;
}

/** What each refusal from `get_back()` means to the manager. */
function getBackRefusal(raw: string): string {
  if (/admins_only/.test(raw)) return 'Only the office can get a worker back.';
  if (/no_open_no_show/.test(raw)) return 'This worker has no unresolved no-show to get back from.';
  // D17 (20260930100000): after the section's end the press is not an
  // arrival, and the board has no field for one.
  if (/arrived_at_required/.test(raw)) {
    return 'The shift has ended — use Resolve in the violation log to enter the arrival and finish.';
  }
  return raw;
}

/**
 * §3.3. Cancel event. The event stays visible, greyed out, for the record;
 * every booking moves to cancelled; auto-assign stops; and N12 reaches
 * everyone still attached — including anyone with an open Radar application,
 * not only the confirmed and invited (CANCEL_NOTIFIES).
 *
 * One RPC, `cancel_event()` (20260925100100), so it is all or nothing. This
 * used to be four writes from here, and the bookings update's error was never
 * read: a refused update left a Cancelled event with live bookings and no
 * N12, and the manager was told it had worked.
 */
export async function cancelEvent(eventId: string, reason: string): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: cancelEventRefusal('reason_required') };
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data, error } = await supabase.rpc('cancel_event', {
    p_event: eventId,
    p_reason: trimmed,
  });
  if (error) return { error: `The event was not cancelled: ${error.message}` };
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (result.ok !== true) return { error: cancelEventRefusal(String(result.reason ?? '')) };

  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  return { ok: true };
}

/**
 * §3.3 / §10.4. The manager picks a Radar applicant from the Potential pool:
 * `applied → confirmed` through `accept_application()` (20260925100000),
 * which re-checks every hard gate and the fill under a row lock, queues N10,
 * and — if this fills the role — closes the other applications with N10c.
 *
 * There is no Decline: the scope ends an application only by N10, N10c, the
 * worker withdrawing it, or the event being cancelled (ADR-0023).
 */
export async function acceptApplication(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data, error } = await supabase.rpc('accept_application', { p_booking: bookingId });
  if (error) {
    // The rota guard trigger is the backstop underneath the gates; its
    // refusal arrives as an exception named after the reason.
    const guard = /rota_guard_(rtw_expired|visa_cap|wtr_cap)/.exec(error.message)?.[1];
    if (guard) {
      return {
        error: acceptApplicationRefusal(guard === 'rtw_expired' ? 'rtw_expired' : 'hours_limit'),
      };
    }
    return { error: error.message };
  }
  const result = (data ?? {}) as { ok?: boolean; reason?: string; closedApplications?: number };
  revalidatePath(`/events/${eventId}`);
  if (result.ok !== true) return { error: acceptApplicationRefusal(String(result.reason ?? '')) };

  const closed = Number(result.closedApplications ?? 0);
  return closed > 0
    ? {
        ok: true,
        warning: `The role is now fully confirmed: ${closed} other ${closed === 1 ? 'applicant was' : 'applicants were'} told it filled (N10c).`,
      }
    : { ok: true };
}

/**
 * §3.3 / §3.4. The manager's Invite on a Potential pool row.
 *
 * One RPC, `office_invite_worker()` (20260927100000): admin only; refuses a
 * cancelled event, an ended section (RULE-16) and a fully confirmed role
 * under the section lock; then `invite_worker(…, 'manual', …)` re-applies
 * every hard gate, writes the `invited` booking and queues N5 exactly as an
 * auto-assign round does. Unlike a round it is not held back by the
 * invitations already out — §3.4: "the manager can always invite them by
 * hand at any point".
 */
export async function inviteWorker(
  eventId: string,
  shiftId: string,
  staffId: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();
  // The server-side check in front of the database one (claim 2b): the
  // action is a public endpoint; office_invite_worker's own check stays.
  const refused = await adminRefusal(supabase);
  if (refused) return { error: refused };

  const { data, error } = await supabase.rpc('office_invite_worker', {
    p_shift: shiftId,
    p_staff: staffId,
  });
  if (error) {
    // The rota guard trigger is the backstop underneath the gates.
    const guard = /rota_guard_(rtw_expired|visa_cap|wtr_cap)/.exec(error.message)?.[1];
    if (guard) {
      return { error: inviteRefusal(guard === 'rtw_expired' ? 'rtw_expired' : 'hours_limit') };
    }
    if (/not_authorised/.test(error.message)) {
      return { error: 'Only the office can invite workers to a shift.' };
    }
    return { error: `The invitation was not sent: ${error.message}` };
  }
  const result = (data ?? {}) as { invited?: boolean; reason?: string };
  revalidatePath(`/events/${eventId}`);
  if (result.invited !== true) return { error: inviteRefusal(String(result.reason ?? '')) };
  return { ok: true };
}

/**
 * §3.4. The auto-assign switch, event level. Both switches must be on for a
 * round to reach a section (`auto_assign_due_shifts`), so turning this off
 * stops the hourly rounds and the same-day escalation for every role at
 * once; open invitations stay open (§3.6 — auto-assign never withdraws).
 *
 * Admin only: `events` carries an admin-only write policy, and an update
 * that RLS filters away changes nothing and returns no error, so the
 * returned row count is what tells a refusal from a success.
 */
export async function setEventAutoAssign(eventId: string, on: boolean): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data, error } = await supabase
    .from('events')
    .update({ auto_assign: on })
    .eq('id', eventId)
    .is('cancelled_at', null)
    .select('id');
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) {
    return {
      error: 'The switch was not changed: the event is cancelled, or you are not an admin.',
    };
  }
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/**
 * §3.4. The same switch for one role section — "for example when the
 * client asks for a specific person". Admin only, for the same reason.
 */
export async function setRoleAutoAssign(
  eventId: string,
  shiftId: string,
  on: boolean,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('cancelled_at')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) return { error: eventError.message };
  if (!event) return { error: 'That event no longer exists.' };
  if ((event as { cancelled_at: string | null }).cancelled_at) {
    return { error: 'This event is cancelled; auto-assign has stopped for it.' };
  }

  const { data, error } = await supabase
    .from('shift_requirements')
    .update({ auto_assign: on })
    .eq('id', shiftId)
    .eq('event_id', eventId)
    .select('id');
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) {
    return { error: 'The switch was not changed: the role is gone, or you are not an admin.' };
  }
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Offer up a shift — ADR-0045, docs/19 §4 point 3
// ---------------------------------------------------------------------

/**
 * The two office RPCs (20260930201100), typed locally until the Phase 2
 * type regeneration — the `(supabase as unknown as XRpc)` pattern.
 */
interface OfferOfficeRpc {
  rpc(
    fn: 'office_open_offer_to_pool' | 'office_decline_cover',
    args: Record<string, string | null>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

function offerOfficeError(raw: string): string {
  if (/not_authorised/.test(raw)) return 'Only the office can act on a cover request.';
  if (/offer_not_found/.test(raw)) return 'That request no longer exists.';
  return raw;
}

/**
 * Open to pool: a worker's cover request (inside 72 h) goes to the other
 * workers, takeable until the section starts and pushed in the hourly OF1
 * rounds while auto-assign is on. The worker stays booked until someone
 * takes it. Admin only and audited, in `office_open_offer_to_pool()`.
 */
export async function openOfferToPool(eventId: string, offerId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = (await db()) as unknown as OfferOfficeRpc;
  const { data, error } = await supabase.rpc('office_open_offer_to_pool', { p_offer: offerId });
  if (error) return { error: offerOfficeError(error.message) };
  revalidatePath(`/events/${eventId}`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  return result.ok === true
    ? { ok: true }
    : { error: offerOfficeRefusal(String(result.reason ?? '')) };
}

/**
 * Decline: the office closes the cover request and OF6 tells the worker
 * they are still booked. The note is the office's own record and is never
 * sent. To cover the shift by hand instead, Withdraw the booking as usual.
 */
export async function declineCover(
  eventId: string,
  offerId: string,
  note: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = (await db()) as unknown as OfferOfficeRpc;
  const trimmed = note.trim();
  const { data, error } = await supabase.rpc('office_decline_cover', {
    p_offer: offerId,
    p_note: trimmed === '' ? null : trimmed,
  });
  if (error) return { error: offerOfficeError(error.message) };
  revalidatePath(`/events/${eventId}`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  return result.ok === true
    ? { ok: true }
    : { error: offerOfficeRefusal(String(result.reason ?? '')) };
}
