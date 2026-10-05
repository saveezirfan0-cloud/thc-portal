/**
 * The row shapes /venues reads. They mirror `venue_directory_v` and
 * `venue_types` from 0007_venues_directory.sql.
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
  /** When the venue was added (an instant; shown as a UK date). */
  created_at: string;
  /** The manager who added it; NULL for venues that pre-date the column. */
  created_by: string | null;
  created_by_name: string | null;
  /** The client this venue belongs to (ADR-0087), or NULL when it is not tied to one. */
  client_id: string | null;
  client_name: string | null;
}

/** A client the venue modal can tie a venue to. */
export interface ClientChoice {
  id: string;
  name: string;
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
  client_id: string | null;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
