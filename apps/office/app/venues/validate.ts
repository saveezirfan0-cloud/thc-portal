import { MAX_RADIUS_M, MIN_RADIUS_M } from './geo';
import type { VenueDraft } from './types';

/**
 * The browser-side half of the rules 0007_venues_directory.sql enforces in
 * `assert_venue_input` and in the `venues` CHECK constraints.
 *
 * It lives in its own module, not inside `actions.ts`, because a `'use
 * server'` file may export nothing but async functions — and a rule that
 * decides whether a venue can be saved is worth testing directly.
 */
export function validateVenue(draft: VenueDraft): string | null {
  if (!draft.name.trim()) return 'Give the venue a name.';

  // §9.11: the address is reverse-geocoded from the pin and read-only. An
  // empty one means the lookup has not resolved yet, and saving would write
  // a venue whose address a manager has no way to correct.
  if (!draft.address.trim()) return 'Drop the pin so the address can be looked up.';

  if (!Number.isFinite(draft.lat) || !Number.isFinite(draft.lng)) {
    return 'Drop the pin on the map first.';
  }
  if (draft.lat < -90 || draft.lat > 90 || draft.lng < -180 || draft.lng > 180) {
    return 'That pin is not on the globe. Drop it again.';
  }
  if (!draft.venue_type) return 'Choose a venue type.';

  if (
    !Number.isInteger(draft.geofence_radius_m) ||
    draft.geofence_radius_m < MIN_RADIUS_M ||
    draft.geofence_radius_m > MAX_RADIUS_M
  ) {
    return `The geofence radius must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M} m.`;
  }
  return null;
}
