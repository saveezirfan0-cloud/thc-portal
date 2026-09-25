import { project, unproject } from '../../onboarding/geo';
import type { LatLng, Point } from '../../onboarding/geo';

/**
 * The shift screen's map (§5.1, `wireframes/staff/shift-detail.html` a–c, h):
 * the venue's geofence circle to scale, its centre, and the worker's own
 * position — nothing to pan, nothing to drop.
 *
 * ADR-0005's approach, not a GL library: the Web Mercator maths is the
 * onboarding pin map's (`onboarding/geo.ts`, itself the office venue map's),
 * the design system's map ground is drawn underneath, and Mapbox raster
 * tiles are laid on top only when `NEXT_PUBLIC_MAPBOX_TOKEN` is set. The
 * projection, not the imagery, places the circle and the dot, so the map is
 * honest in every environment.
 *
 * This file is the pure half — which zoom, where each mark lands — so it
 * can be tested without a DOM.
 */

/** Metres per pixel at the equator, zoom 0, 256 px tiles. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392804097;

/** Whole zoom levels only (ADR-0005). 17 keeps a 100 m circle readable. */
export const MAP_MAX_ZOOM = 17;
/**
 * Below this the circle is a dot and the map says nothing a distance line
 * does not. A worker further out than fits here is drawn at the edge of the
 * frame, pointing the right way, rather than zooming out to a county.
 */
export const MAP_MIN_ZOOM = 10;
/** Room around the framed marks, in pixels. */
const PAD = 18;

export interface ShiftMapInput {
  venue: LatLng;
  radiusM: number;
  me: LatLng | null;
  width: number;
  height: number;
}

export interface ShiftMapLayout {
  zoom: number;
  centre: LatLng;
  venue: Point;
  radiusPx: number;
  /** Null without a fix. */
  me: (Point & { offMap: boolean }) | null;
}

export function metresPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_METRES_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Frames the geofence and, where it fits at a readable zoom, the worker
 * too: the largest whole zoom at which both are inside the padded viewport.
 * With the worker too far away, the circle alone is framed and their dot is
 * pinned to the edge on the bearing towards them (`offMap`).
 */
export function layoutShiftMap({
  venue,
  radiusM,
  me,
  width,
  height,
}: ShiftMapInput): ShiftMapLayout {
  const w = Math.max(1, width - PAD * 2);
  const h = Math.max(1, height - PAD * 2);

  const fits = (zoom: number, withMe: boolean): boolean => {
    const r = radiusM / metresPerPixel(venue.lat, zoom);
    const v = project(venue, zoom);
    let minX = v.x - r;
    let maxX = v.x + r;
    let minY = v.y - r;
    let maxY = v.y + r;
    if (withMe && me) {
      const m = project(me, zoom);
      minX = Math.min(minX, m.x);
      maxX = Math.max(maxX, m.x);
      minY = Math.min(minY, m.y);
      maxY = Math.max(maxY, m.y);
    }
    return maxX - minX <= w && maxY - minY <= h;
  };

  let zoom = MAP_MAX_ZOOM;
  let withMe = Boolean(me);
  while (zoom > MAP_MIN_ZOOM && !fits(zoom, withMe)) zoom -= 1;
  if (withMe && !fits(zoom, true)) {
    // Too far to show both: frame the circle, and put the worker on the edge.
    withMe = false;
    zoom = MAP_MAX_ZOOM;
    while (zoom > MAP_MIN_ZOOM && !fits(zoom, false)) zoom -= 1;
  }

  // Centre on the middle of what is framed.
  const v = project(venue, zoom);
  let centrePx = v;
  if (withMe && me) {
    const m = project(me, zoom);
    centrePx = { x: (v.x + m.x) / 2, y: (v.y + m.y) / 2 };
  }
  const origin = { x: centrePx.x - width / 2, y: centrePx.y - height / 2 };
  const toScreen = (p: Point): Point => ({ x: p.x - origin.x, y: p.y - origin.y });

  const venueAt = toScreen(v);
  let meAt: ShiftMapLayout['me'] = null;
  if (me) {
    const raw = toScreen(project(me, zoom));
    const inside = raw.x >= PAD && raw.x <= width - PAD && raw.y >= PAD && raw.y <= height - PAD;
    meAt = inside
      ? { ...raw, offMap: false }
      : { ...clampToEdge(venueAt, raw, width, height), offMap: true };
  }

  return {
    zoom,
    centre: unproject(centrePx, zoom),
    venue: venueAt,
    radiusPx: radiusM / metresPerPixel(venue.lat, zoom),
    me: meAt,
  };
}

/** The point where the line from `from` towards `to` leaves the padded frame. */
function clampToEdge(from: Point, to: Point, width: number, height: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const tx = dx === 0 ? Infinity : ((dx > 0 ? width - PAD : PAD) - from.x) / dx;
  const ty = dy === 0 ? Infinity : ((dy > 0 ? height - PAD : PAD) - from.y) / dy;
  const t = Math.max(0, Math.min(1, tx, ty));
  return { x: from.x + dx * t, y: from.y + dy * t };
}
