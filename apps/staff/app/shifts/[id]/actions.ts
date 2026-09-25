'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';

/**
 * The four buttons on the shift screen (§5.1, §5.2b).
 *
 * Every rule is in the database — the grace, the No-show lock, the
 * strict-buffer turn-away, which timestamp a check-out records. These
 * actions carry a GPS fix in and a message key out; nothing here decides
 * anything, which is what keeps the screen and the payroll view agreeing.
 */

export type RpcResult = { error: string } | { ok: true; result: Record<string, unknown> };

const NO_SUPABASE =
  'This environment has no Supabase project, so the shift cannot be updated (docs/04-setup-github-vercel-supabase.md).';

function configured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** See apps/office/app/venues/actions.ts: the generated types are a placeholder. */
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, string | number | null>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call(
  fn: string,
  args: Record<string, string | number | null>,
  bookingId: string,
): Promise<RpcResult> {
  if (!configured()) return { error: NO_SUPABASE };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: REASONS[error.message] ?? error.message };
  revalidatePath(`/shifts/${bookingId}`);
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

export async function checkIn(bookingId: string, lat: number, lng: number): Promise<RpcResult> {
  return call('attempt_check_in', { p_booking: bookingId, p_lat: lat, p_lng: lng }, bookingId);
}

/**
 * §5.1: check-out is open from anywhere, so the fix is optional. With none,
 * `check_out()` treats the press as off site — the last on-site fix from
 * the ping trail is recorded, or with no such fix the No check-out
 * violation is raised (RULE-02). The database decides; this only forwards.
 */
export async function checkOut(
  bookingId: string,
  lat: number | null,
  lng: number | null,
): Promise<RpcResult> {
  const fixed = Number.isFinite(lat) && Number.isFinite(lng);
  return call(
    'check_out',
    { p_booking: bookingId, p_lat: fixed ? lat : null, p_lng: fixed ? lng : null },
    bookingId,
  );
}

export async function startBreak(bookingId: string): Promise<RpcResult> {
  return call('start_break', { p_booking: bookingId }, bookingId);
}

export async function finishBreak(bookingId: string): Promise<RpcResult> {
  return call('finish_break', { p_booking: bookingId }, bookingId);
}

/**
 * Background tracking (§5.1). The PWA can only do this while the screen is
 * open — ADR-0001 and docs/06 are where the native shell for the rest is
 * argued — but a fix every time the worker looks at their phone is already
 * the difference between an off-site check-out recording their real finish
 * and falling to RULE-02.
 */
export async function recordPing(bookingId: string, lat: number, lng: number): Promise<RpcResult> {
  return call('record_ping', { p_booking: bookingId, p_lat: lat, p_lng: lng }, bookingId);
}

const REASONS: Record<string, string> = {
  not_your_booking: 'That shift belongs to someone else.',
  booking_not_confirmed: 'This shift is not confirmed, so you cannot check in.',
  event_cancelled: 'This event has been cancelled.',
  not_checked_in: 'You have not checked in yet.',
  already_checked_out: 'You have already checked out of this shift.',
  breaks_paid_by_client: 'This client pays for breaks, so there is nothing to log.',
  // D16: only a compliant worker can start a shift; the database refuses it.
  staff_not_compliant:
    'Your account is not active for shifts at the moment, so you cannot check in. Please contact the office.',
};
