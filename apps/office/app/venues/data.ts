import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { Venue, VenueType } from './types';

/**
 * Reads for /venues (§9.11).
 *
 * Everything goes through the anon-key server client, so RLS is what
 * decides what comes back: `venues` carries admin_all and nothing else, and
 * both views are security_invoker (0005_venues_directory.sql).
 */

/** True once the app is pointed at a Supabase project (docs/04). */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface VenuesPageData {
  venues: Venue[];
  venueTypes: VenueType[];
  /** Set when the screen cannot be filled; rendered instead of an empty table. */
  problem: string | null;
}

export async function loadVenuesPage(): Promise<VenuesPageData> {
  if (!supabaseConfigured()) {
    return {
      venues: [],
      venueTypes: [],
      problem:
        'This environment has no Supabase project, so the venue directory cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }

  const supabase = createClient(await cookies());

  const [venues, venueTypes] = await Promise.all([
    supabase
      .from('venue_directory_v')
      .select(
        'id, name, address, venue_type, venue_type_label, default_radius_m, geofence_radius_m, lat, lng, events_past, events_upcoming',
      )
      // No deleted-venue filter here: venue_directory_v is the live
      // directory (0005_venues_directory.sql), so soft delete is one rule
      // in one place rather than a condition every caller has to repeat.
      .order('name')
      .returns<Venue[]>(),
    // sort_order is the §9.11 table's own order (0005_venues_directory.sql),
    // so the type picker and the standard-radius grid read like the scope.
    supabase
      .from('venue_types')
      .select('key, label, default_radius_m, sort_order')
      .order('sort_order')
      .returns<VenueType[]>(),
  ]);

  const error = venues.error ?? venueTypes.error;
  if (error) return { venues: [], venueTypes: [], problem: error.message };

  return { venues: venues.data ?? [], venueTypes: venueTypes.data ?? [], problem: null };
}
