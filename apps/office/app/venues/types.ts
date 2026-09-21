/**
 * The row shapes /venues reads. They mirror `venue_directory_v` and
 * `venue_types` from 0006_venues_directory.sql.
 *
 * `packages/db`'s generated types are still the Phase 0 placeholder, so the
 * queries below name their own return shape with `.returns<T>()` rather than
 * pretending to be typed by a schema that has not been generated yet.
 * Regenerating (`pnpm --filter @thc/db gen:types`) makes these redundant.
 */

/** A row of the editable §9.11 standard-radius table. */
export interface VenueType {
  key: string;
  label: string;
  default_radius_m: number;
  /** §9.11's own order for the table — "Other" last, whatever its radius. */
  sort_order: number;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  venue_type: string;
  venue_type_label: string;
  /** The standard radius for this venue's type, for the "default 150" note. */
  default_radius_m: number;
  geofence_radius_m: number;
  lat: number;
  lng: number;
  /** Events that have taken place here — the list's Events column (§9.11). */
  events_past: number;
  /** Events still to come — the delete confirmation's count (§9.11). */
  events_upcoming: number;
}

/** Named in the delete confirmation: "Gala Dinner (Fri 19 Sep)". */
export interface UpcomingEvent {
  event_id: string;
  title: string;
  /** ISO date; the event date is a calendar date, not an instant. */
  event_date: string;
}

/** What the create/edit modal hands back to the server. */
export interface VenueDraft {
  name: string;
  address: string;
  lat: number;
  lng: number;
  venue_type: string;
  geofence_radius_m: number;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
