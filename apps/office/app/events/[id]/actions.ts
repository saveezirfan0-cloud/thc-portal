'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  UK_ZONE,
  acceptApplicationRefusal,
  cancelEventRefusal,
  canCancelBooking,
  canMarkNoShow,
  derivedEventWindow,
  displayTime,
  eventStatus,
  payrollWarning,
  type CancelCause,
} from '@thc/domain';
import { TEMPLATES, outboxKey } from '@thc/notifications';
import { eventsDb, supabaseConfigured } from '../db';
import { type CloneSource, canToggleAutoAssign, cloneSections, cloneTitle } from './board-rules';

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
  if (context.noShow) return { error: 'This worker is already recorded as a No-show.' };

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
 *
 * It is the database's `resolve_violation()` on the no_show entry — the
 * same transaction the Violation log uses (§9.5): a `check_logs` row with
 * `check_in_at = now`, the booking moved `confirmed → worked`, the entry
 * reclassified to Late and closed with the note. This used to delete the
 * violation and insert a Late one from here, with no arrival recorded: the
 * worker stayed `confirmed` with no check-in, so `payable_shifts_v` paid
 * nothing, BG-03 raised the No-show again a minute later beside the new
 * Late, and BG-02's check-out reminder skipped them. The note is
 * mandatory (§9.5, confirmed 31.07.2026).
 */
export async function getBack(
  eventId: string,
  bookingId: string,
  note: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  if (!note.trim()) return { error: GET_BACK_REASONS.note_required! };
  const supabase = await db();

  const { data: violation } = await supabase
    .from('violations')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('type', 'no_show')
    .eq('resolved', false)
    .maybeSingle();
  if (!violation) return { error: 'This worker is not recorded as a No-show.' };

  const { data, error } = await supabase.rpc('resolve_violation', {
    p_violation: (violation as { id: string }).id,
    p_note: note.trim(),
    p_actual_finish: null,
  });
  if (error) return { error: GET_BACK_REASONS[error.message] ?? error.message };

  revalidatePath(`/events/${eventId}`);
  revalidatePath('/checkin');
  const result = (data ?? {}) as { payrollExported?: boolean };
  return {
    ok: true,
    warning: payrollWarning('get_back', Boolean(result.payrollExported)) ?? undefined,
  };
}

/** `resolve_violation`'s errcodes, in the manager's language. */
const GET_BACK_REASONS: Record<string, string> = {
  note_required: 'A note is required. Say how the worker was brought back (§9.5).',
  admins_only: 'Only a manager can do this.',
  violation_not_found: 'This No-show has already been dealt with.',
};

/**
 * §3.4. The Auto-assign switch, at event or role level, on the board —
 * "default ON … can be turned off at event or role level" — available in
 * Upcoming and Ongoing (the same-day escalation runs during the event).
 * Not a booking transition, so no `state.ts` edge: the flag is what the
 * hourly round and the escalation job read. `event_edit_lock_guard` leaves
 * this column editable after the start (20260926111100).
 */
export async function setAutoAssign(
  eventId: string,
  target: { level: 'event' } | { level: 'section'; sectionId: string },
  on: boolean,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data: event } = await supabase
    .from('events')
    .select('cancelled_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return { error: 'That event no longer exists.' };
  const { data: sections } = await supabase
    .from('shift_requirements')
    .select('starts_at, ends_at')
    .eq('event_id', eventId);
  const window = derivedEventWindow(
    ((sections ?? []) as { starts_at: string; ends_at: string }[]).map((s) => ({
      startsAt: new Date(s.starts_at),
      endsAt: new Date(s.ends_at),
    })),
  );
  const status = eventStatus(window, (event as { cancelled_at: string | null }).cancelled_at);
  if (!canToggleAutoAssign(status)) {
    return { error: 'Auto-assign can only be switched on an Upcoming or Ongoing event (§3.4).' };
  }

  const { error } =
    target.level === 'event'
      ? await supabase.from('events').update({ auto_assign: on }).eq('id', eventId)
      : await supabase
          .from('shift_requirements')
          .update({ auto_assign: on })
          .eq('id', target.sectionId)
          .eq('event_id', eventId);
  if (error) return { error: error.message };

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/**
 * §3.2. Duplicate: "Multi-day = separate events created via Duplicate (the
 * clone copies the roles, NOT the staff)". The events row is copied —
 * client, venue snapshot, notes, on-site contact, the policies copied at
 * creation, the event-level switch — with no PO (the client issues one per
 * event), no cancellation and no export stamp; every role section comes
 * across on the chosen date at the same UK wall-clock times; no booking
 * does. The manager lands in the builder to rename it and adjust.
 */
export async function duplicateEvent(
  eventId: string,
  toDate: string,
): Promise<{ error: string } | { ok: true; id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return { error: 'Choose the date of the new event.' };
  if (!supabaseConfigured()) return { error: NO_SUPABASE };
  const supabase = await db();

  const { data: source } = await supabase
    .from('events')
    .select(
      'client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m, title, notes, onsite_contact, pays_breaks, pays_buffer, auto_assign',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!source) return { error: 'That event no longer exists.' };

  const { data: sectionRows } = await supabase
    .from('shift_requirements')
    .select(
      'role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate, dress_code, auto_assign, allocation_per_hour',
    )
    .eq('event_id', eventId)
    .order('starts_at');
  const sources = (sectionRows ?? []) as CloneSource[];
  if (sources.length === 0) return { error: 'This event has no role sections to copy.' };

  const original = source as Record<string, unknown> & { title: string };
  const { data: created, error } = await supabase
    .from('events')
    .insert({
      client_id: original['client_id'],
      venue_id: original['venue_id'],
      venue_name: original['venue_name'],
      venue_address: original['venue_address'],
      venue_location: original['venue_location'],
      geofence_radius_m: original['geofence_radius_m'],
      title: cloneTitle(original.title),
      event_date: toDate,
      notes: original['notes'],
      onsite_contact: original['onsite_contact'],
      po_number: null,
      pays_breaks: original['pays_breaks'],
      pays_buffer: original['pays_buffer'],
      auto_assign: original['auto_assign'],
    })
    .select('id')
    .single();
  if (error || !created) return { error: error?.message ?? 'The event could not be duplicated.' };
  const newId = (created as { id: string }).id;

  const { error: sectionError } = await supabase
    .from('shift_requirements')
    .insert(cloneSections(sources, toDate).map((row) => ({ ...row, event_id: newId })));
  if (sectionError) {
    // Never leave a clone with no sections on the calendar (no window, no status).
    await supabase.from('events').delete().eq('id', newId);
    return { error: sectionError.message };
  }

  revalidatePath('/events');
  redirect(`/events/${newId}/edit`);
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
  /** Per BOOKING (`booking_payroll_exported`), not per event (§3.3, §9.9). */
  payrollExported: boolean;
  noShow: boolean;
}

/** The shift behind a booking, and whether ITS payroll line has already gone out. */
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

  const [{ data: section }, { data: exported }, { data: noShow }] = await Promise.all([
    supabase
      .from('shift_requirements')
      .select('starts_at, ends_at, event_id')
      .eq('id', shiftId)
      .maybeSingle(),
    // The export marks lines per booking and holds an unresolved No
    // check-out out of the run, so the event's stamp is the wrong question.
    supabase.rpc('booking_payroll_exported', { p_booking: bookingId }),
    supabase
      .from('violations')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('type', 'no_show')
      .eq('resolved', false)
      .maybeSingle(),
  ]);
  if (!section) return null;
  const shift = section as { starts_at: string; ends_at: string; event_id: string };

  return {
    staffId,
    startsAt: new Date(shift.starts_at),
    endsAt: new Date(shift.ends_at),
    payrollExported: exported === true,
    noShow: Boolean(noShow),
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
