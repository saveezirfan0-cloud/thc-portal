import type { createClient } from '@thc/db/server';

/**
 * The worker's phone for the monitor's rows, so a manager can ring someone
 * who has not checked in, signed out late or was flagged without opening
 * their profile.
 *
 * It is not a column of `checkin_monitor_v` or `late_check_outs()` — the view
 * and the RPC are pinned column for column — so it is read off `staff`
 * through admin_all, as the Staff directory reads it (staff/data.ts). Only
 * rows not removed: §1.7 retires a removed worker's number. A failed read
 * leaves the map null, so the rows draw no phone rather than a claimed "none"
 * — it never takes the monitor down.
 */

type SessionClient = ReturnType<typeof createClient>;

/** PostgREST carries `in.(…)` in the URL; chunked to keep the request line short. */
const IN_CHUNK = 150;

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

/** staff id → E.164 phone (null: none on record or removed); null when unreadable. */
export async function loadPhones(
  supabase: SessionClient,
  staffIds: readonly string[],
): Promise<Map<string, string | null> | null> {
  const ids = [...new Set(staffIds)];
  const phones = new Map<string, string | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return phones;
  const results = await Promise.all(
    chunked(ids).map((chunk) =>
      supabase.from('staff').select('id, phone').in('id', chunk).is('removed_at', null),
    ),
  );
  if (results.some((r) => r.error)) return null;
  for (const r of results) {
    for (const row of (r.data ?? []) as unknown as { id: string; phone: string | null }[]) {
      phones.set(row.id, row.phone);
    }
  }
  return phones;
}

/** booking id → staff id, for the rows (the late sign-out list) that carry no staff id. */
export async function loadBookingStaff(
  supabase: SessionClient,
  bookingIds: readonly string[],
): Promise<Map<string, string> | null> {
  const ids = [...new Set(bookingIds)];
  const staff = new Map<string, string>();
  if (ids.length === 0) return staff;
  const results = await Promise.all(
    chunked(ids).map((chunk) => supabase.from('bookings').select('id, staff_id').in('id', chunk)),
  );
  if (results.some((r) => r.error)) return null;
  for (const r of results) {
    for (const row of (r.data ?? []) as unknown as { id: string; staff_id: string }[]) {
      staff.set(row.id, row.staff_id);
    }
  }
  return staff;
}
