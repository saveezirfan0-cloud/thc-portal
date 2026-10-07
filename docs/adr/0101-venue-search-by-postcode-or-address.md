# ADR-0101 · The venue modal can find a site by postcode or street address

**Status:** Accepted · **Refines:** ADR-0005, ADR-0093 · **Scope:** §9.11

## Context
§9.11 builds a venue by clicking or dragging a pin on a map, with the address reverse-geocoded from the pin. On a UK map at the default zoom that means panning and zooming to find the site before the pin can go down, which is the slow part of adding a venue.

## Decision
- A "Find the venue" row above the map takes a postcode or a street address. Submitting it (Enter or Search) asks `searchPlaces` for up to five candidates; picking one drops the pin there and frames the map on it.
- The venue's address is still the geocoder's, never typed. A picked candidate supplies its own address (no second lookup); dragging or clicking the pin afterwards reverse-geocodes as before. The address field stays read-only, so §9.11's "filled in automatically from the pin, read-only" still holds. The slider is unchanged.
- Provider rules follow ADR-0093: Mapbox forward geocoding when a token is set, OpenStreetMap Nominatim search otherwise. Both are limited to Great Britain, like the reverse lookup.
- Search runs on submit, not per keystroke: Nominatim's policy forbids search-as-you-type, and a postcode only means something whole.
- `searchPlaces` is a public server-action endpoint that spends the Mapbox token, so it carries the same signed-in-admin check as `reverseGeocode` (audit D52), before any request leaves.

## Consequences
- A venue can be built from a postcode in a few seconds; the map click remains for sites a search cannot name (a field, a festival ground).
- Nothing in the database, RLS or the RPCs changes.
- The wireframe gains the search row (wireframes/backoffice/venues.html).
