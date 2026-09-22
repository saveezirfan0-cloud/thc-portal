'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../db';
import type { ActionResult } from './types';

/**
 * The manager's actions on the event board (§3.3).
 *
 * Every one of them is an RPC. Nothing here decides anything: the reasons
 * an invitation is refused, the two-week window on a manual No-show and
 * the payroll caveat all live in SQL, because the engine and the jobs
 * reach the same rules without going through this file.
 *
 * There is no Confirm. §3.3: "The WORKER confirms, in the app — the
 * manager has no Confirm button, only Withdraw."
 */
const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | boolean | null>;

interface RpcClient {
  rpc(
    fn: string,
    args: RpcArguments,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function callRpc(
  fn: string,
  args: RpcArguments,
  eventId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/events/${eventId}`);
  revalidatePath('/events');
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}

/**
 * The refusal reasons `invite_worker` can return. They are the gates,
 * plus the two bookkeeping answers — and the manager needs the words, not
 * a silent no-op, because most of them are fixable.
 */
const INVITE_REFUSAL: Record<string, string> = {
  wrong_role: 'Not qualified for this role — add it on their profile first (§9.6).',
  blocked: 'Blocked. Unblock from their profile before inviting (§4.3).',
  booked_elsewhere: 'Already booked on another event in this window (§3.4).',
  hours_limit: 'This shift would take them past their weekly hours limit (RULE-20).',
  self_cancelled: 'They self-cancelled off this event and cannot be re-invited (RULE-04).',
  do_not_return: 'Marked Do not return at this client (§9.6).',
  not_bookable: 'This worker has left or been removed and cannot be booked (§10.6, §1.7).',
  already_has_booking: 'They already have a booking on this role section.',
  event_cancelled: 'This event is cancelled.',
  target_met: 'The role is already invited up to its allocation — withdraw someone first (§3.4).',
};

export async function inviteWorker(
  eventId: string,
  shiftId: string,
  staffId: string,
): Promise<ActionResult> {
  const result = await callRpc(
    'invite_worker',
    { p_shift: shiftId, p_staff: staffId, p_source: 'manual' },
    eventId,
  );
  if (!result.ok) return result;

  if (result.data.invited === false) {
    const reason = String(result.data.reason ?? '');
    return { ok: false, message: INVITE_REFUSAL[reason] ?? `Not invited: ${reason}` };
  }
  return { ok: true };
}

export async function withdrawBooking(
  eventId: string,
  bookingId: string,
  reason: string,
): Promise<ActionResult> {
  const result = await callRpc(
    'withdraw_booking',
    { p_booking: bookingId, p_reason: reason.trim() || null },
    eventId,
  );
  if (!result.ok) return result;
  if (result.data.withdrawn === false) {
    return { ok: false, message: 'That booking had already been cancelled.' };
  }
  return { ok: true };
}

/**
 * §3.3: recording a No-show on an already-exported shift is allowed and
 * does not reverse the payment. The database says whether it was
 * exported; this turns that into the sentence the scope dictates, because
 * a manager who is not told will assume the money moved.
 */
export async function markNoShow(eventId: string, bookingId: string): Promise<ActionResult> {
  const result = await callRpc('mark_no_show', { p_booking: bookingId }, eventId);
  if (!result.ok) return result;

  if (result.data.payrollExported === true) {
    return {
      ok: true,
      message:
        'This shift has already been included in a payroll export. Marking a No-show now will not reverse the payment — please notify Finance to reverse it.',
    };
  }
  return { ok: true };
}

/**
 * "Get back" (§3.3) IS Resolve (§9.5) on the same entry — the scope says
 * pressing either registers the worker as arrived and reclassifies them
 * from No-show to Late, with the minutes measured from the press. So this
 * calls `resolve_violation`, the function the violation log calls, and
 * the note is mandatory in both places for the same reason.
 */
export async function getBack(
  eventId: string,
  violationId: string,
  note: string,
): Promise<ActionResult> {
  if (note.trim() === '') {
    return {
      ok: false,
      message: 'Get back needs a note — it is mandatory on every resolution (§9.5).',
    };
  }
  const result = await callRpc(
    'resolve_violation',
    { p_violation: violationId, p_note: note.trim() },
    eventId,
  );
  if (!result.ok) return result;

  if (result.data.payrollExported === true) {
    return {
      ok: true,
      message:
        'This shift has already been included in a payroll export. This change will not add the payment — please notify Finance to pay it.',
    };
  }
  return { ok: true };
}

export async function setSectionAutoAssign(
  eventId: string,
  shiftId: string,
  on: boolean,
): Promise<ActionResult> {
  const result = await callRpc('set_section_auto_assign', { p_shift: shiftId, p_on: on }, eventId);
  return result.ok ? { ok: true } : result;
}

export async function setEventAutoAssign(eventId: string, on: boolean): Promise<ActionResult> {
  const result = await callRpc('set_event_auto_assign', { p_event: eventId, p_on: on }, eventId);
  return result.ok ? { ok: true } : result;
}

export async function cancelEvent(eventId: string, reason: string): Promise<ActionResult> {
  if (reason.trim() === '') {
    return { ok: false, message: 'Cancelling an event needs a reason (§3.3).' };
  }
  const result = await callRpc(
    'cancel_event',
    { p_event: eventId, p_reason: reason.trim() },
    eventId,
  );
  if (!result.ok) return result;

  const cancelled = Number(result.data.bookingsCancelled ?? 0);
  const told = Number(result.data.workersNotified ?? 0);
  return {
    ok: true,
    message: `Event cancelled. ${cancelled} booking${cancelled === 1 ? '' : 's'} released, ${told} worker${told === 1 ? '' : 's'} notified (N12).`,
  };
}
