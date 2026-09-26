'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { validateUnavailability } from '@thc/domain';
import type { UnavailabilityInput } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../../db';
import { AVAILABILITY_REASONS } from './model';

/**
 * The Add sheet and Delete — `add_my_unavailability()` and
 * `remove_my_unavailability()` (20260930202000, ADR-0043).
 *
 * The rules are the RPC's. `validateUnavailability()` runs first only so a
 * refusal the phone can already see costs no round trip; the database
 * makes the same refusals in the same order and is the one that counts.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';

/** Refusals of who is asking (they raise rather than return a reason). */
const RAISED: Record<string, string> = {
  not_editable:
    'Your availability can’t be changed right now. If something needs correcting, contact the office at admin@thehospitalitycompany.co.uk.',
  account_closed: 'We couldn’t find your record. Please contact the office.',
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
};

function sentence(raw: string): string {
  for (const [code, text] of Object.entries({ ...AVAILABILITY_REASONS, ...RAISED })) {
    if (raw === code || raw.includes(code)) return text;
  }
  return 'That didn’t go through. Please try again.';
}

/** A conflict as it crosses the action boundary: instants as ISO strings. */
export interface ConflictWire {
  bookingId: string;
  event: string;
  role: string;
  venue: string;
  startsAt: string;
  endsAt: string;
}

export type AddResult =
  { ok: true; saved: number; conflicts: ConflictWire[] } | { ok: false; message: string };

export async function addUnavailability(input: UnavailabilityInput): Promise<AddResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const check = validateUnavailability(input);
  if (!check.ok) return { ok: false, message: AVAILABILITY_REASONS[check.reason] };

  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('add_my_unavailability', {
    p_from_date: input.fromDate,
    p_to_date: input.toDate ?? null,
    p_from_time: input.fromTime ?? null,
    p_to_time: input.toTime ?? null,
    p_repeat_weeks: input.repeatWeeks ?? 0,
  });
  if (error) return { ok: false, message: sentence(error.message) };

  const answer = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    ids?: string[];
    conflicts?: ConflictWire[];
  };
  if (!answer.ok) return { ok: false, message: sentence(answer.reason ?? '') };
  revalidatePath('/profile/availability');
  return {
    ok: true,
    saved: answer.ids?.length ?? 0,
    conflicts: (answer.conflicts ?? []).map((c) => ({
      bookingId: String(c.bookingId),
      event: String(c.event ?? ''),
      role: String(c.role ?? ''),
      venue: String(c.venue ?? ''),
      startsAt: String(c.startsAt),
      endsAt: String(c.endsAt),
    })),
  };
}

export type RemoveResult = { ok: true; removed: number } | { ok: false; message: string };

/** One entry, or (`wholeSeries`) it and the rest of its weekly series. */
export async function removeUnavailability(
  id: string,
  wholeSeries: boolean,
): Promise<RemoveResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('remove_my_unavailability', {
    p_id: id,
    p_whole_series: wholeSeries,
  });
  if (error) return { ok: false, message: sentence(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; reason?: string; removed?: number };
  if (!answer.ok) return { ok: false, message: sentence(answer.reason ?? '') };
  revalidatePath('/profile/availability');
  return { ok: true, removed: Number(answer.removed ?? 0) };
}
