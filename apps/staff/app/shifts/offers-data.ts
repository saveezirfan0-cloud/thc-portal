import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from '../db';
import type { Found, Loaded } from '../data';
import type { BookingOffer } from './offers';

/**
 * The two offer reads the Staff App makes — ADR-0046, docs/19 §4.
 *
 * Both are `security definer` RPCs (20260930201100) that resolve the
 * caller themselves, like `staff_bookings()` and `staff_open_shifts()`:
 * the staff role holds no policy on `shift_offers`, and nothing here names
 * a worker. `staff_open_offers()` never returns the offerer.
 *
 * Both hand back `Loaded` — the rows and whether reading them failed —
 * like `loadBookings()` (audit D18). A failed offer read is not "nobody
 * has offered anything": on My shifts it would drop the Offered chip and,
 * on the shift screen, offer "Offer this shift" on a shift already out
 * there; on Radar it would read as "Nothing open nearby".
 */

/** The new RPCs, typed locally until the Phase 2 type regeneration. */
interface OfferReadRpc {
  rpc(
    fn: 'staff_booking_offers' | 'staff_open_offers',
    args?: Record<string, string | null>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function db(): Promise<OfferReadRpc> {
  return staffDb(await cookies()) as unknown as OfferReadRpc;
}

/** One row of `staff_booking_offers()` in the screens' shape. */
export function toBookingOffer(row: Record<string, unknown>): BookingOffer {
  const mode = row['offer_mode'];
  return {
    bookingId: row['booking_id'] as string,
    autoAssign: row['auto_assign'] === true,
    offerId: (row['offer_id'] as string | null) ?? null,
    mode: mode === 'pool' || mode === 'office' || mode === 'direct' ? mode : null,
    expiresAt: row['offer_expires_at'] ? new Date(row['offer_expires_at'] as string) : null,
    note: (row['offer_note'] as string | null) ?? null,
  };
}

/** The caller's live confirmed bookings, each with its open offer (audit D18: or the failure). */
export async function loadBookingOffers(): Promise<Loaded<BookingOffer>> {
  if (!supabaseConfigured()) return { rows: [], problem: null };
  const { data, error } = await (await db()).rpc('staff_booking_offers');
  if (error) return { rows: [], problem: error.message || 'staff_booking_offers failed' };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toBookingOffer), problem: null };
}

/** `loadBookingOffers()` rows by booking id — the chip's and the panel's lookup. */
export function offersByBooking(rows: readonly BookingOffer[]): Map<string, BookingOffer> {
  return new Map(rows.map((row) => [row.bookingId, row]));
}

/** One offered shift, as Radar's "Up for grabs" shows it — never the offerer. */
export interface OpenOffer {
  offerId: string;
  shiftId: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  /** The BASE rate — never the holiday element (§9.8). */
  payRate: number;
  dressCode: string;
  venueName: string;
  venueAddress: string;
  distanceKm: number | null;
  expiresAt: Date;
  qualified: boolean;
  venueLat: number | null;
  venueLng: number | null;
  geofenceRadiusM: number | null;
  homeLat: number | null;
  homeLng: number | null;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** One row of `staff_open_offers()` in the screens' shape. */
export function toOpenOffer(row: Record<string, unknown>): OpenOffer {
  return {
    offerId: row['offer_id'] as string,
    shiftId: row['shift_id'] as string,
    eventId: row['event_id'] as string,
    eventTitle: row['event_title'] as string,
    eventDate: row['event_date'] as string,
    role: row['role'] as string,
    startsAt: new Date(row['starts_at'] as string),
    endsAt: new Date(row['ends_at'] as string),
    payRate: Number(row['pay_rate']),
    dressCode: (row['dress_code'] as string) ?? '',
    venueName: row['venue_name'] as string,
    venueAddress: row['venue_address'] as string,
    distanceKm: num(row['distance_km']),
    expiresAt: new Date(row['expires_at'] as string),
    qualified: row['qualified'] === true,
    venueLat: num(row['venue_lat']),
    venueLng: num(row['venue_lng']),
    geofenceRadiusM: num(row['geofence_radius_m']),
    homeLat: num(row['home_lat']),
    homeLng: num(row['home_lng']),
  };
}

/**
 * "Up for grabs" — the open offers this worker may take (RULE-17
 * visibility, decided in SQL), or the failure (audit D18).
 */
export async function loadOpenOffers(): Promise<Loaded<OpenOffer>> {
  if (!supabaseConfigured()) return { rows: [], problem: null };
  const { data, error } = await (await db()).rpc('staff_open_offers', { p_offer: null });
  if (error) return { rows: [], problem: error.message || 'staff_open_offers failed' };
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toOpenOffer), problem: null };
}

/**
 * One offer by id — or nothing, when this worker may not see it. "Could
 * not read" is kept apart from "not found", so a timeout is not a 404.
 */
export async function findOpenOffer(offerId: string): Promise<Found<OpenOffer>> {
  if (!supabaseConfigured()) return { row: null, problem: null };
  const { data, error } = await (await db()).rpc('staff_open_offers', { p_offer: offerId });
  if (error) return { row: null, problem: error.message || 'staff_open_offers failed' };
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toOpenOffer);
  return { row: rows.find((o) => o.offerId === offerId) ?? null, problem: null };
}
