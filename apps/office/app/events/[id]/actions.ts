'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  UK_ZONE,
  acceptApplicationRefusal,
  cancelEventRefusal,
  canCancelBooking,
  canMarkNoShow,
  displayTime,
  payrollWarning,
  type CancelCause,
} from '@thc/domain';
import { TEMPLATES, outboxKey } from '@thc/notifications';
import { eventsDb, supabaseConfigured } from '../db';

export type ActionResult = { error: string } | { ok: true; warning?: string };

const NO_SUPABASE =
  'This environment has no Supabase project, so the board cannot be changed (docs/04-setup-github-vercel-supabase.md).';

/**
 * The manager's actions on the event board — Scope §3.3.
 *
 * There is deliberately no Confirm here: the WORKER confirms, in the app.
 * The manager can only withdraw, record a no-show, undo one, take a Radar
 * application forward (the applicant already said yes — §3.3, N10), or
 * cancel the whole event.
 */

async function db() {
  return eventsDb(await cookies());
}

/**
 * Withdraw removes a worker from the shift (§3.3). An invitation withdrawn
 * and a confirmation withdrawn are the same transition — `cancelled` with a
 * cause — so the slot reopens and auto-assign can top it up (§3.6).
 */
export async function withdraw(
  eventId: string,
  bookingId: string,
  wasConfirmed: boolean,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  // The §8 register renders N10b from `{event}` and `{dateTime}`, so the
  // values have to be read before the booking is cancelled.
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, staff_id, status, shift_id, shift_requirements(starts_at, events(title))')
    .eq('id', bookingId)
    .maybeSingle();
  if (!booking) return { error: 'That booking no longer exists.' };
  // §3.6: a worked or turned-away booking has no edge to cancelled, and the
  // database would refuse the update (bookings_state_guard). Say why.
  if (!canCancelBooking((booking as { status: string }).status)) {
    return {
      error:
        'This worker has already checked in (or been turned away), so the booking cannot be withdrawn (§3.6).',
    };
  }

  const shift = (
    booking as { shift_requirements?: { starts_at?: string; events?: { title?: string } } }
  ).shift_requirements;
  const eventTitle = shift?.events?.title ?? 'your shift';
  const when = shift?.starts_at
    ? displayTime(new Date(shift.starts_at), 'scheduled', UK_ZONE, true).primary
    : '';

  const { error } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      // The §3.6 vocabulary (CANCEL_CAUSES, bookings_cancel_cause_check).
      // This used to write 'withdraw', which nothing read: the Staff App's
      // "You've been removed from this shift" screen keys on office_withdraw.
      cancel_cause: 'office_withdraw' satisfies CancelCause,
    })
    .eq('id', bookingId);
  if (error) return { error: error.message };

  // N10b only where there was something to lose: a confirmed worker had the
  // shift, an invited one merely had the offer.
  let queueFailed: string | null = null;
  if (wasConfirmed) {
    queueFailed = await enqueue(
      supabase,
      'N10b',
      bookingId,
      (booking as { staff_id: string }).staff_id,
      { event: eventTitle, dateTime: when },
    );
  }

  revalidatePath(`/events/${eventId}`);
  return queueFailed
    ? { ok: true, warning: `Withdrawn, but the worker could not be notified: ${queueFailed}` }
    : { ok: true };
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

/**
 * One outbox row, keyed so a repeat press does not queue a second push (§8).
 *
 * `payload` is the VALUES map, not rendered copy. The drain renders from the
 * register itself — `render(entry.title, values)` in
 * `packages/notifications/src/outbox.ts` — and ignores any title or body a
 * row carries. Sending pre-rendered text therefore delivered the literal
 * "Shift time changed — now {window}" to the worker. `queue_booking_push`
 * (20260921141500) has always written values for exactly this reason.
 */
async function enqueue(
  supabase: Awaited<ReturnType<typeof db>>,
  code: 'N10b',
  bookingId: string,
  staffId: string,
  values: Record<string, string>,
): Promise<string | null> {
  const template = TEMPLATES[code];
  if (!template) return null;
  // Through the RPC, never straight at the table: `notification_outbox`
  // carries only `admin_read` (001_rls_guard assertion 8), so a direct
  // insert reaches RLS, finds no INSERT policy and is rejected every time.
  const { error } = await supabase.rpc('queue_office_notifications', {
    p_rows: [
      {
        key: outboxKey(code, 'booking', bookingId),
        channel: template.channel,
        template: code,
        recipient_staff_id: staffId,
        payload: { ...values, bookingId },
      },
    ],
  });
  // supabase-js returns `{ data, error }` and never throws. Not reading it is
  // how the original defect stayed invisible: the write failed, the action
  // returned ok, and the manager was told the opposite of what happened.
  return error ? error.message : null;
}
