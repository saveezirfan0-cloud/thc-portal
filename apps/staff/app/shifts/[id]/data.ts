import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { ShiftDetail } from './types';

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * One booking, as the worker who owns it.
 *
 * RLS is the gate: `staff_self_bookings` means a forged id returns nothing
 * rather than somebody else's shift. The check log and the breaks come with
 * it so the screen knows which of the §10.4 states it is in without a
 * second round trip.
 */
export async function loadShift(bookingId: string): Promise<ShiftDetail | null> {
  if (!supabaseConfigured()) return null;

  const supabase = createClient(await cookies());
  const { data } = await supabase
    .from('bookings')
    .select(
      `id, status, confirmed_at,
       logs:check_logs ( check_in_at, check_out_at, manager_finish_at ),
       breaks ( id, started_at, ended_at ),
       shift:shift_id (
         starts_at, ends_at, pay_rate, dress_code,
         role:role_id ( name ),
         event:event_id ( title, venue_name, venue_address, notes, onsite_contact,
                          geofence_radius_m, pays_breaks )
       )`,
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (!data) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = data as any;
  const shift = row.shift;
  const event = shift?.event;
  const log = (row.logs ?? [])[0];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // The venue point is a PostGIS geography, which PostgREST does not hand
  // back as numbers, so the coordinates come from the RPC's own distance
  // maths rather than from here. The screen only needs the radius to say
  // how far away the worker is; `attempt_check_in` recomputes it server
  // side, and that computation is the one that decides.
  const coords = await venuePoint(bookingId);

  return {
    bookingId: row.id,
    status: row.status,
    confirmedAt: row.confirmed_at ?? null,
    eventTitle: event?.title ?? '',
    venueName: event?.venue_name ?? '',
    venueAddress: event?.venue_address ?? '',
    onsiteContact: event?.onsite_contact ?? null,
    notes: event?.notes ?? null,
    dressCode: shift?.dress_code ?? null,
    roleName: shift?.role?.name ?? '',
    startsAt: shift?.starts_at,
    endsAt: shift?.ends_at,
    payRate: Number(shift?.pay_rate ?? 0),
    venueLat: coords?.lat ?? 0,
    venueLng: coords?.lng ?? 0,
    geofenceRadiusM: event?.geofence_radius_m ?? 0,
    breaksLogged: !event?.pays_breaks,
    checkInAt: log?.check_in_at ?? null,
    checkOutAt: log?.manager_finish_at ?? log?.check_out_at ?? null,
    breaks: (row.breaks ?? [])
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      .map((b: any) => ({ id: b.id, startedAt: b.started_at, endedAt: b.ended_at ?? null }))
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      .sort((a: any, b: any) => a.startedAt.localeCompare(b.startedAt)),
  };
}

/**
 * The venue's centre, for the map and the distance the screen shows while
 * the worker is walking there. `booking_venue_point` is a tiny reader
 * because geography columns do not survive PostgREST as numbers.
 */
async function venuePoint(bookingId: string): Promise<{ lat: number; lng: number } | null> {
  const supabase = createClient(await cookies()) as unknown as {
    rpc(fn: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { data } = await supabase.rpc('booking_venue_point', { p_booking: bookingId });
  const point = data as { lat?: number; lng?: number } | null;
  return point && typeof point.lat === 'number' && typeof point.lng === 'number'
    ? { lat: point.lat, lng: point.lng }
    : null;
}
