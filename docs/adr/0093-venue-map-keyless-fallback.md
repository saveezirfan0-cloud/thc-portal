# ADR-0093 · The venue map and address lookup work without a Mapbox token

**Status:** Accepted · **Refines:** ADR-0005

## Context
ADR-0005 drew the venue map's own surface and laid Mapbox tiles over it only when `NEXT_PUBLIC_MAPBOX_TOKEN` was set, and looked the pin's address up with Mapbox Geocoding. With no token (the state of every deploy until one is bought) the map was a bare grid and the address lookup refused, so **no venue could be created**.

## Decision
- No token: tiles come from `tile.openstreetmap.org`, with "© OpenStreetMap contributors" shown on the map; in dark mode they are inverted with a CSS filter (OSM has no dark style).
- No token: `reverseGeocode` calls OpenStreetMap Nominatim (`display_name`), with an identifying User-Agent. The caller check (audit D52) still runs first.
- A token, when set, still wins for both — Mapbox remains the production choice.

## Consequences
- Venues can be created in every environment.
- OSM's public tile and Nominatim servers are for light use (max ~1 request/second, no bulk). That fits a back office placing a handful of venues by hand; the modal already debounces the pin. If volume grows, set the Mapbox tokens (docs/16-owner-guide.md §6.2).
