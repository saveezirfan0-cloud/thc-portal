# ADR-0005 · The venue map draws its own tiles instead of loading Mapbox GL

**Status:** Accepted (directory bot, §9.11 Venues) · **Refines:** `docs/01-architecture.md` "Maps / geocoding — Mapbox GL + Mapbox Geocoding"

## Context
§9.11 needs two maps: a full-width one showing every venue's geofence circle at once, to scale, and a 300 px one in the create/edit modal where the pin is dropped and dragged and the circle follows the 100–3000 m slider. `docs/01-architecture.md` names Mapbox GL for this, and `NEXT_PUBLIC_MAPBOX_TOKEN` is already in `turbo.json`'s pass-through list.

Two things make the GL library a poor fit for the first screen that needs a map:
- It is a ~200 kB client dependency, and neither map needs vector styling, 3D, rotation or any of what it is for. Both need a projection, a pin, a circle to scale, pan and whole-level zoom.
- Every environment in the repo today — local, CI, the preview deploys — has no Mapbox token. With a GL map, both screens would render blank there, and the geofence, which is the thing the screen exists to show, would be unreviewable.

## Decision
`apps/office/app/venues/VenueMap.tsx` implements the Web Mercator maths itself (`geo.ts`, unit-tested) and draws pins and circles on the design system's `.map` surface.

- Zoom is whole levels only, moved with the `+`/`−` controls and a double-click — never the wheel, which on a full-width map would trap a manager scrolling past it.
- When `NEXT_PUBLIC_MAPBOX_TOKEN` is set, Mapbox raster tiles for the current appearance are laid over that surface as plain `<img>` elements. At whole zoom levels a 256 px tile grid is four lines of arithmetic.
- Without a token, the `.map` token grid and the scale bar still place every pin and size every geofence correctly: the projection, not the imagery, is what positions them.
- In the modal, the circle grows with the slider rather than the map re-framing to keep it the same apparent size — §9.11 wants the manager to *see* the circle cover the site. The view gives way only at the edges: it drops a zoom level once the circle passes ~92% of the shorter side, and adds one if it has shrunk below ~10%. At those two thresholds the circle does jump smaller as the radius grows, which is the cost of whole zoom levels; the scale bar keeps the reading honest.
- Reverse geocoding is unchanged from `docs/01`: Mapbox Geocoding, called from a server action so the token can stay server-side. With no token the modal says so and refuses to save rather than storing a venue with a blank or invented address.

## Token handling
`NEXT_PUBLIC_MAPBOX_TOKEN` is interpolated into tile URLs in the browser, which is what a *public* Mapbox token is for — but it must be URL-restricted in the Mapbox account to the three Vercel domains, or it is a bill anyone can run up. Reverse geocoding does not use it: that call is a server action and prefers a server-only `MAPBOX_TOKEN` (docs/04 already sets one for the Edge Functions), falling back to the public token only so a preview deploy can resolve an address at all.

## Consequences
- No new dependency, and `apps/office`'s first-load JS for `/venues` stays around 111 kB.
- The map is honest about scale in every environment, which is what makes "does this circle cover the whole site?" reviewable on a preview deploy.
- Anything the GL library would give us later — rotation, vector styles, fractional zoom, clustering — is not there. If a screen needs it, swapping `VenueMap` for a GL wrapper is a change behind one component's props.
- The tile URL pins the `mapbox/light-v11` and `mapbox/dark-v11` styles, chosen from `data-theme` so the map matches the appearance switch (ADR-0003).
