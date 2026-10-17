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
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * PostgREST's "no function with these arguments". The four-argument
 * check-in / check-out / ping (20261012121200, p_accuracy) reach the
 * database after this app does: Vercel builds on the push to main, `db
 * push` runs once CI is green. In that window the call is made again
 * without the accuracy, which the old three-argument functions take, so a
 * deploy never stops a shift starting (security round 12.10, QA blocker).
 */
const NO_SUCH_FUNCTION = 'PGRST202';

/**
 * `revalidate`: whether the press changed what the screen shows. When it
 * did, `revalidatePath` makes Next render the shift page into this action's
 * own response, so the screen has the booking as the database now has it
 * the moment the press returns — no second `router.refresh()` render. A
 * location ping changes nothing on screen, so it must not pay for a page
 * render (go-live audit B3: 8–9 Supabase calls per ping, every 2 minutes,
 * for every worker on shift).
 */
async function call(
  fn: string,
  args: Record<string, string | number | null>,
  bookingId: string,
  { revalidate = true }: { revalidate?: boolean } = {},
): Promise<RpcResult> {
  if (!configured()) return { error: NO_SUPABASE };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  let { data, error } = await supabase.rpc(fn, args);
  if (error?.code === NO_SUCH_FUNCTION && 'p_accuracy' in args) {
    const { p_accuracy: _accuracy, ...withoutAccuracy } = args;
    ({ data, error } = await supabase.rpc(fn, withoutAccuracy));
  }
  if (error) return { error: REASONS[error.message] ?? error.message };
  if (revalidate) revalidatePath(`/shifts/${bookingId}`);
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/**
 * The fix's reported accuracy radius in metres (`coords.accuracy`), or null
 * when there is none to send. The database weighs it (security round
 * 12.10, item 6): a fix claiming to be inside the geofence with a 2 km
 * error circle is not proof of being on site. Only a finite, non-negative
 * number is forwarded; anything else is "unknown", never zero.
 */
function accuracyOf(accuracy: number | null | undefined): number | null {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
    ? accuracy
    : null;
}

export async function checkIn(
  bookingId: string,
  lat: number,
  lng: number,
  accuracy: number | null = null,
): Promise<RpcResult> {
  return call(
    'attempt_check_in',
    { p_booking: bookingId, p_lat: lat, p_lng: lng, p_accuracy: accuracyOf(accuracy) },
    bookingId,
  );
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
  accuracy: number | null = null,
): Promise<RpcResult> {
  const fixed = Number.isFinite(lat) && Number.isFinite(lng);
  return call(
    'check_out',
    {
      p_booking: bookingId,
      p_lat: fixed ? lat : null,
      p_lng: fixed ? lng : null,
      p_accuracy: fixed ? accuracyOf(accuracy) : null,
    },
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
export async function recordPing(
  bookingId: string,
  lat: number,
  lng: number,
  accuracy: number | null = null,
): Promise<RpcResult> {
  return call(
    'record_ping',
    { p_booking: bookingId, p_lat: lat, p_lng: lng, p_accuracy: accuracyOf(accuracy) },
    bookingId,
    // The trail is read by check-out, not drawn on this screen.
    { revalidate: false },
  );
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
