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

  const token = process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return {
      ok: false,
      message:
        'Address lookup is not configured in this environment (MAPBOX_TOKEN). See docs/04-setup-github-vercel-supabase.md.',
    };
  }

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
