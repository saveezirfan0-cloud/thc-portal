'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CANCEL_NOTIFIES, UK_ZONE, canMarkNoShow, displayTime, payrollWarning } from '@thc/domain';
import { TEMPLATES, outboxKey } from '@thc/notifications';
import { eventsDb, supabaseConfigured } from '../db';

export type ActionResult = { error: string } | { ok: true; warning?: string };

const NO_SUPABASE =
  'This environment has no Supabase project, so the board cannot be changed (docs/04-setup-github-vercel-supabase.md).';

/**
 * The manager's actions on the event board — Scope §3.3.
 *
 * There is deliberately no Confirm here: the WORKER confirms, in the app.
 * The manager can only withdraw, record a no-show, undo one, or cancel the
 * whole event.
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
      cancel_cause: 'withdraw',
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
 * not only the confirmed and invited.
 */
export async function cancelEvent(eventId: string, reason: string): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: 'Give a reason for the cancellation (§3.3).' };
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data: sectionData } = await supabase
    .from('shift_requirements')
    .select('id')
    .eq('event_id', eventId);
  const sectionIds = ((sectionData ?? []) as { id: string }[]).map((s) => s.id);

  const { data: bookingData } = sectionIds.length
    ? await supabase
        .from('bookings')
        .select('id, staff_id, status')
        .in('shift_id', sectionIds)
        .in('status', [...CANCEL_NOTIFIES])
    : { data: [] };
  const affected = (bookingData ?? []) as { id: string; staff_id: string }[];
  let queueFailed: string | null = null;

  const { error } = await supabase
    .from('events')
    .update({
      cancelled_at: new Date().toISOString(),
      cancel_reason: trimmed,
      // Auto-assign stops for this event immediately (§3.3, point 3).
      auto_assign: false,
    })
    .eq('id', eventId);
  if (error) return { error: error.message };

  if (affected.length > 0) {
    await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_cause: 'event_cancelled',
      })
      .in(
        'id',
        affected.map((b) => b.id),
      );

    // N12 carries no placeholders (§8), so the payload is just the deep-link
    // value. One row per worker; the unique key makes a second press a no-op.
    for (const booking of affected) {
      const failed = await enqueue(supabase, 'N12', booking.id, booking.staff_id, {});
      if (failed) queueFailed ??= failed;
    }
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  // §3.3 promises everyone still attached is notified. If the queue refused,
  // the manager is told so rather than shown a clean success.
  return queueFailed
    ? {
        ok: true,
        warning: `Event cancelled, but ${affected.length === 1 ? 'the worker' : 'the workers'} could not be notified: ${queueFailed}`,
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
  code: 'N10b' | 'N12',
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
