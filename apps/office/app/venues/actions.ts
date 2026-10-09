'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';
import { validateVenue } from './validate';
import type { ActionResult, UpcomingEvent, VenueDraft } from './types';

/**
 * Writes and lookups for /venues (§9.11).
 *
 * The three mutations go through the RPCs in 0007_venues_directory.sql, not
 * through table writes: a PostgREST body cannot build a geography, and the
 * radius, the venue type and the coordinate range are rejected by the
 * database as well as by the form. RLS is the gate on all three — these
 * functions are `security invoker`, so a caller who is not an admin is
 * refused by the policy, not by a role check written here.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so venues cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** True only for a signed-in admin (§1.4), read through the session. */
async function callerIsAdmin(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .maybeSingle<{ role: string }>();
  return profile?.role === 'admin';
}

/**
 * `packages/db`'s generated types are still the Phase 0 placeholder, whose
 * `Functions` map is empty, so supabase-js types every RPC's arguments as
 * `undefined`. This is the one place that works around it: the argument
 * names still have to match 0007_venues_directory.sql, and regenerating
 * (`pnpm --filter @thc/db gen:types`) makes the cast redundant.
 */
type RpcArguments = Record<string, string | number>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

async function callRpc(fn: string, args: RpcArguments): Promise<ActionResult> {
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };

  revalidatePath('/venues');
  return { ok: true };
}

export async function createVenue(draft: VenueDraft): Promise<ActionResult> {
  const invalid = validateVenue(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('create_venue', {
    p_name: draft.name,
    p_address: draft.address,
    p_lat: draft.lat,
    p_lng: draft.lng,
    p_venue_type: draft.venue_type,
    p_geofence_radius_m: draft.geofence_radius_m,
  });
}

export async function updateVenue(id: string, draft: VenueDraft): Promise<ActionResult> {
  const invalid = validateVenue(draft);
  if (invalid) return { ok: false, message: invalid };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('update_venue', {
    p_id: id,
    p_name: draft.name,
    p_address: draft.address,
    p_lat: draft.lat,
    p_lng: draft.lng,
    p_venue_type: draft.venue_type,
    p_geofence_radius_m: draft.geofence_radius_m,
  });
}

/**
 * Soft delete (§9.11). The venue leaves the directory and the event
 * builder's venue picker; every event already built keeps the address,
 * location and radius it copied at build time, so nothing in the diary
 * breaks.
 */
export async function deleteVenue(id: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  return callRpc('delete_venue', { p_id: id });
}

/**
 * The events the delete confirmation names (§9.11).
 *
 * `null` means the list could not be read at all, which is not the same
 * answer as an empty array: the confirmation must not turn "I don't know"
 * into "this venue is used on no upcoming events".
 */
export async function loadUpcomingEvents(venueId: string): Promise<UpcomingEvent[] | null> {
  if (!supabaseConfigured()) return null;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('venue_upcoming_events_v')
    .select('event_id, title, event_date')
    .eq('venue_id', venueId)
    .order('event_date')
    .returns<UpcomingEvent[]>();

  if (error) return null;
  return data ?? [];
}

export type GeocodeResult = { ok: true; address: string } | { ok: false; message: string };

/** One candidate for the venue search: where it is and how it reads. */
export interface PlaceMatch {
  address: string;
  lat: number;
  lng: number;
}

export type PlaceSearchResult =
  { ok: true; matches: PlaceMatch[] } | { ok: false; message: string };

const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_LENGTH = 200;
const MAX_MATCHES = 5;

/**
 * Forward geocoding for the venue search (§9.11): a postcode or a street
 * address finds the place and the manager picks the right candidate, which
 * drops the pin there. The address on the venue is still the geocoder's, read
 * back for that point, never typed (ADR-0101) — this only saves hunting for
 * the site on the map.
 *
 * Same provider rules and the same caller check as `reverseGeocode`: a server
 * action is a public POST endpoint and this one spends the Mapbox token.
 */
export async function searchPlaces(query: string): Promise<PlaceSearchResult> {
  const q = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : '';
  if (q.length < MIN_SEARCH_LENGTH) {
    return { ok: false, message: 'Type a postcode or a street address to search.' };
  }
  if (q.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: 'That search is too long — try a postcode or a street.' };
  }

  if (!(await callerIsAdmin())) {
    return { ok: false, message: 'Only the office can look up addresses.' };
  }

  const token = process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return token ? searchPlacesMapbox(q, token) : searchPlacesOpenStreetMap(q);
}

const NOTHING_FOUND =
  'Nothing found for that. Check the postcode, or add the town to the street address.';

async function searchPlacesMapbox(q: string, token: string): Promise<PlaceSearchResult> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(MAX_MATCHES));
  // THC is a UK agency: "SW1A 1AA" must not resolve to another country's
  // address format, and a street name must not match one overseas.
  url.searchParams.set('country', 'gb');
  url.searchParams.set('language', 'en');
  url.searchParams.set('access_token', token);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, message: `Address search failed (${response.status}). Try again.` };
    }
    const body = (await response.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number] };
        properties?: { full_address?: string; name?: string; place_formatted?: string };
      }[];
    };
    const matches: PlaceMatch[] = [];
    for (const feature of body.features ?? []) {
      const [lng, lat] = feature.geometry?.coordinates ?? [];
      const properties = feature.properties;
      const address =
        properties?.full_address ??
        [properties?.name, properties?.place_formatted].filter(Boolean).join(', ');
      if (typeof lat !== 'number' || typeof lng !== 'number' || !address) continue;
      matches.push({ address, lat, lng });
    }
    return matches.length > 0 ? { ok: true, matches } : { ok: false, message: NOTHING_FOUND };
  } catch {
    return { ok: false, message: 'Address search is unreachable. Try again.' };
  }
}

/**
 * The keyless fallback (ADR-0093). Nominatim forbids search-as-you-type, so
 * the modal searches on submit, not on every keystroke.
 */
async function searchPlacesOpenStreetMap(q: string): Promise<PlaceSearchResult> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', q);
  url.searchParams.set('countrycodes', 'gb');
  url.searchParams.set('limit', String(MAX_MATCHES));
  url.searchParams.set('accept-language', 'en');

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'thc-portal-back-office/1.0' },
    });
    if (!response.ok) {
      return { ok: false, message: `Address search failed (${response.status}). Try again.` };
    }
    const body = (await response.json()) as { display_name?: string; lat?: string; lon?: string }[];
    const matches: PlaceMatch[] = [];
    for (const row of Array.isArray(body) ? body : []) {
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!row.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      matches.push({ address: row.display_name, lat, lng });
    }
    return matches.length > 0 ? { ok: true, matches } : { ok: false, message: NOTHING_FOUND };
  } catch {
    return { ok: false, message: 'Address search is unreachable. Try again.' };
  }
}

/**
 * Reverse geocoding for the pin (§9.11): the address is looked up, never
 * typed. Mapbox is the provider docs/01-architecture.md picked.
 *
 * The call is made here rather than in the browser so the token stays on the
 * server where one is configured for it; `NEXT_PUBLIC_MAPBOX_TOKEN` is the
 * documented Vercel variable, so it is the fallback.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: 'Drop the pin on the map first.' };
  }

  // A server action is a public POST endpoint, and this one spends the
  // Mapbox token and touches no RLS on the way. So it checks the caller
  // itself: a signed-in admin, read through the session and `profiles`'
  // own policy — never a claim the browser sent (audit D52).
  if (!(await callerIsAdmin())) {
    return { ok: false, message: 'Only the office can look up addresses.' };
  }

  const token = process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return reverseGeocodeOpenStreetMap(lat, lng);

  const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('limit', '1');
  // THC is a UK agency; biasing the lookup keeps a pin near a border from
  // resolving to the wrong country's address format.
  url.searchParams.set('country', 'gb');
  url.searchParams.set('language', 'en');
  url.searchParams.set('access_token', token);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, message: `Address lookup failed (${response.status}). Try again.` };
    }
    const body = (await response.json()) as {
      features?: { properties?: { full_address?: string; place_formatted?: string } }[];
    };
    const properties = body.features?.[0]?.properties;
    const address = properties?.full_address ?? properties?.place_formatted;
    if (!address) {
      return { ok: false, message: 'No address at this point — move the pin.' };
    }
    return { ok: true, address };
  } catch {
    return { ok: false, message: 'Address lookup is unreachable. Try again.' };
  }
}

/**
 * The keyless fallback (ADR-0093): with no Mapbox token the pin is still
 * looked up, against OpenStreetMap's Nominatim, so a venue can be created in
 * any environment. Nominatim's usage policy asks for an identifying
 * User-Agent and no more than one request a second; the modal debounces the
 * pin and drops stale answers, and a manager creates venues by hand.
 */
async function reverseGeocodeOpenStreetMap(lat: number, lng: number): Promise<GeocodeResult> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('accept-language', 'en');

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'thc-portal-back-office/1.0' },
    });
    if (!response.ok) {
      return { ok: false, message: `Address lookup failed (${response.status}). Try again.` };
    }
    const body = (await response.json()) as { display_name?: string; error?: string };
    if (!body.display_name) {
      return { ok: false, message: 'No address at this point — move the pin.' };
    }
    return { ok: true, address: body.display_name };
  } catch {
    return { ok: false, message: 'Address lookup is unreachable. Try again.' };
  }
}
