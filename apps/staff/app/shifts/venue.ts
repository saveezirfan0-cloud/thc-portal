import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';

export interface VenuePoint {
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * The venue's centre and geofence radius for one booking (§5.1, §9.11).
 *
 * `booking_venue_point` is a security-definer reader with the booking's
 * own ownership test, because a worker holds no select policy on `events`
 * and `venue_location` is a PostGIS geography PostgREST cannot hand back
 * as numbers anyway. Advisory only: the distance that DECIDES a check-in is
 * recomputed inside `attempt_check_in` against the same column.
 */
export async function venuePoint(bookingId: string): Promise<VenuePoint | null> {
  const supabase = createClient(await cookies()) as unknown as {
    rpc(fn: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { data } = await supabase.rpc('booking_venue_point', { p_booking: bookingId });
  const point = data as { lat?: number; lng?: number; radiusM?: number } | null;
  return point && typeof point.lat === 'number' && typeof point.lng === 'number'
    ? { lat: point.lat, lng: point.lng, radiusM: Number(point.radiusM ?? 0) }
    : null;
}
