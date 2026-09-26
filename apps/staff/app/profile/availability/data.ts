import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../../db';
import type { Loaded } from '../../data';
import type { AvailabilityConflict, UnavailabilityEntry } from './model';

/**
 * The worker's availability entries — `my_unavailability()` (20260930202000).
 *
 * A security-definer RPC that resolves the caller itself: the staff role
 * holds no policy on `staff_unavailability` at all (docs/19 §0.2), so this
 * is the only read there is, and nothing here names a worker.
 *
 * `Loaded`, like `loadBookings()` (audit D18): a failed read is not "no
 * entries". A worker shown an empty calendar would re-enter days already
 * marked, or believe auto-assign may invite them on a day it will not.
 */
export async function loadUnavailability(): Promise<Loaded<UnavailabilityEntry>> {
  if (!supabaseConfigured()) return { rows: [], problem: null };
  const { data, error } = await staffDb(await cookies()).rpc('my_unavailability', {});
  if (error) return { rows: [], problem: error.message || 'my_unavailability failed' };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toEntry), problem: null };
}

export function toEntry(row: Record<string, unknown>): UnavailabilityEntry {
  return {
    id: row['id'] as string,
    startsAt: new Date(row['starts_at'] as string),
    endsAt: new Date(row['ends_at'] as string),
    allDay: Boolean(row['all_day']),
    seriesId: (row['series_id'] as string | null) ?? null,
    seriesIndex:
      row['series_index'] === null || row['series_index'] === undefined
        ? null
        : Number(row['series_index']),
    seriesCount:
      row['series_count'] === null || row['series_count'] === undefined
        ? null
        : Number(row['series_count']),
  };
}

/** One element of `add_my_unavailability()`'s `conflicts`. */
export function toConflict(row: Record<string, unknown>): AvailabilityConflict {
  return {
    bookingId: row['bookingId'] as string,
    event: (row['event'] as string) ?? '',
    role: (row['role'] as string) ?? '',
    venue: (row['venue'] as string) ?? '',
    startsAt: new Date(row['startsAt'] as string),
    endsAt: new Date(row['endsAt'] as string),
  };
}
