'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  acceptApplicationRefusal,
  cancelEventRefusal,
  canMarkNoShow,
  payrollWarning,
} from '@thc/domain';
import { adminRefusal } from '../admin';
import { eventsDb, supabaseConfigured } from '../db';
import { inviteRefusal, withdrawRefusal } from './board-model';

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
 * One RPC, `withdraw_booking()` (20260929110300). It decides from the row
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
 */
export async function markNoShow(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const context = await bookingContext(supabase, bookingId);
  if (!context) return { error: 'That booking no longer exists.' };

  if (!canMarkNoShow({ startsAt: context.startsAt, endsAt: context.endsAt })) {
    return {
      error: 'No-show can be recorded from the shift start until two weeks after it ends (§3.3).',
    };
  }

  const { error } = await supabase.from('violations').insert({
    staff_id: context.staffId,
    booking_id: bookingId,
    type: 'no_show',
  });
  if (error) return { error: error.message };

  revalidatePath(`/events/${eventId}`);
  // The money is corrected in THC's own finance process, outside the app.
  return { ok: true, warning: payrollWarning('no_show', context.payrollExported) ?? undefined };
}

/**
 * §3.3. "Get back" registers the worker as arrived and reclassifies them
 * from No-show to Late, with minutes-late measured from the moment the
 * manager pressed it. It is the only way back in once the check-in button
 * has locked.
 */
export async function getBack(eventId: string, bookingId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const context = await bookingContext(supabase, bookingId);
  if (!context) return { error: 'That booking no longer exists.' };

  const now = new Date();
  const minutesLate = Math.max(
    0,
    Math.round((now.getTime() - context.startsAt.getTime()) / 60_000),
  );

  // The no-show becomes a late: one violation replaces the other rather than
  // both standing, or the worker is penalised twice for one arrival.
  await supabase.from('violations').delete().eq('booking_id', bookingId).eq('type', 'no_show');
  const { error } = await supabase.from('violations').insert({
    staff_id: context.staffId,
    booking_id: bookingId,
    type: 'late',
    minutes_late: minutesLate,
  });
  if (error) return { error: error.message };

  revalidatePath(`/events/${eventId}`);
  return { ok: true, warning: payrollWarning('get_back', context.payrollExported) ?? undefined };
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
    return { error: 'This event is cancelled; auto-assign has stopped for it (§3.3).' };
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

interface BookingContext {
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  payrollExported: boolean;
}

/** The shift behind a booking, and whether its payroll has already gone out. */
async function bookingContext(
  supabase: Awaited<ReturnType<typeof db>>,
  bookingId: string,
): Promise<BookingContext | null> {
  const { data: booking } = await supabase
    .from('bookings')
    .select('staff_id, shift_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (!booking) return null;
  const { staff_id: staffId, shift_id: shiftId } = booking as {
    staff_id: string;
    shift_id: string;
  };

  const { data: section } = await supabase
    .from('shift_requirements')
    .select('starts_at, ends_at, event_id')
    .eq('id', shiftId)
    .maybeSingle();
  if (!section) return null;
  const shift = section as { starts_at: string; ends_at: string; event_id: string };

  const { data: event } = await supabase
    .from('events')
    .select('payroll_exported_at')
    .eq('id', shift.event_id)
    .maybeSingle();

  return {
    staffId,
    startsAt: new Date(shift.starts_at),
    endsAt: new Date(shift.ends_at),
    payrollExported: Boolean(
      (event as { payroll_exported_at?: string } | null)?.payroll_exported_at,
    ),
  };
}
