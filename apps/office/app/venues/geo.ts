/**
 * Web Mercator maths for the Venues map (§9.11).
 *
 * Pure functions with no DOM and no React, so the projection that decides
 * where a pin sits and how wide a 3000 m circle is can be tested on its own.
 * Everything is in the standard 256 px tile space, which is what a raster
 * tile server expects and what `metresPerPixel` below is calibrated to.
 */
export const TILE_SIZE = 256;

/** §9.11: the slider runs 100–3000 m and the number is never typed. */
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 3000;
// One metre: §9.11 says the manager may move the slider "anywhere in the
// 100–3000 m range for that specific site", and a coarser step would put
// 175 m out of reach.
export const RADIUS_STEP_M = 1;

/** The slider's labelled ticks, straight from the wireframe. */
export const RADIUS_TICKS = [100, 500, 1000, 1500, 2000, 2500, 3000] as const;

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

/** Mercator cannot render the poles; every map library clamps at this latitude. */
const MAX_LATITUDE = 85.05112878;

/** Metres per pixel at the equator, zoom 0, 256 px tiles. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392804097;

/** Mean Earth radius (IUGG), the sphere every distance below is measured on. */
const EARTH_RADIUS_M = 6_371_008.8;

/** One degree of latitude, in metres. A degree of longitude shrinks with cos(lat). */
export const METRES_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

/** Where the map opens when there is nothing to fit: central London. */
export const DEFAULT_CENTRE: LatLng = { lat: 51.5074, lng: -0.1278 };
export const DEFAULT_ZOOM = 11;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampLatitude(lat: number): number {
  return clamp(lat, -MAX_LATITUDE, MAX_LATITUDE);
}

/** Wraps a longitude back into (−180, 180], so dragging past the date line still reads sanely. */
export function wrapLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Latitude/longitude → pixel coordinates in the whole-world plane at `zoom`. */
export function project({ lat, lng }: LatLng, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** The inverse of `project`. */
export function unproject({ x, y }: Point, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat: clampLatitude(lat), lng: wrapLongitude(lng) };
}

/**
 * How many metres one pixel covers. Mercator stretches with latitude, which
 * is exactly why the geofence circle has to be drawn from this rather than
 * from a fixed pixels-per-metre: a 500 m circle in London and the same
 * circle in Edinburgh are not the same number of pixels.
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_METRES_PER_PIXEL * Math.cos((clampLatitude(lat) * Math.PI) / 180)) / 2 ** zoom;
}

/** The geofence circle's on-screen radius, in pixels. */
export function radiusInPixels(radiusM: number, lat: number, zoom: number): number {
  return radiusM / metresPerPixel(lat, zoom);
}

/**
 * Great-circle distance in metres.
 *
 * Nothing on this screen draws with it: it is the independent measure the
 * circle-size test checks `radiusInPixels` against, so a mistake in the
 * projection cannot agree with itself. §5.1's check-in gate measures the
 * same distance in PostGIS.
 */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** §9.11 keeps the radius inside the slider's range wherever it came from. */
export function clampRadius(radiusM: number): number {
  return clamp(Math.round(radiusM), MIN_RADIUS_M, MAX_RADIUS_M);
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export interface Circle extends LatLng {
  radiusM: number;
}

/**
 * The centre and zoom that fit every circle in `circles` inside `viewport`,
 * with a little padding. The "On map" tab opens on this so a manager can see
 * where the venues are and how big they are relative to each other (§9.11).
 */
export function fitCircles(
  circles: Circle[],
  viewport: Viewport,
  padding = 48,
): { centre: LatLng; zoom: number } {
  const first = circles[0];
  if (!first) return { centre: DEFAULT_CENTRE, zoom: DEFAULT_ZOOM };

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  for (const circle of circles) {
    // A degree of latitude is the same length everywhere; a degree of
    // longitude shrinks with the cosine of the latitude.
    const latSpan = circle.radiusM / METRES_PER_DEGREE_LAT;
    const lngSpan =
      circle.radiusM /
      (METRES_PER_DEGREE_LAT * Math.max(0.01, Math.cos((circle.lat * Math.PI) / 180)));
    north = Math.max(north, circle.lat + latSpan);
    south = Math.min(south, circle.lat - latSpan);
    east = Math.max(east, circle.lng + lngSpan);
    west = Math.min(west, circle.lng - lngSpan);
  }

  const centre: LatLng = { lat: (north + south) / 2, lng: (east + west) / 2 };
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);

  let zoom = MAX_ZOOM;
  while (zoom > MIN_ZOOM) {
    const topLeft = project({ lat: north, lng: west }, zoom);
    const bottomRight = project({ lat: south, lng: east }, zoom);
    if (bottomRight.x - topLeft.x <= usableWidth && bottomRight.y - topLeft.y <= usableHeight) {
      break;
    }
    zoom -= 1;
  }
  return { centre, zoom };
}

const SCALE_STEPS = [
  10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
] as const;

/** The map's scale bar: the longest round distance that fits in `maxPx`. */
export function scaleBar(
  lat: number,
  zoom: number,
  maxPx = 120,
): { metres: number; px: number; label: string } {
  const mpp = metresPerPixel(lat, zoom);
  let chosen: number = SCALE_STEPS[0];
  for (const step of SCALE_STEPS) {
    if (step / mpp <= maxPx) chosen = step;
  }
  return {
    metres: chosen,
    px: Math.round(chosen / mpp),
    label: chosen >= 1_000 ? `${chosen / 1_000} km` : `${chosen} m`,
  };
}

/**
 * The wireframe prints coordinates with a real minus sign (U+2212) and four
 * decimals — "51.5133, −0.0990" — not a hyphen. Four decimals is ~11 m,
 * which is the right precision for a pin the geofence is measured from.
 */
export function formatCoordinates({ lat, lng }: LatLng): string {
  return `${formatDegrees(lat)}, ${formatDegrees(lng)}`;
}

function formatDegrees(value: number): string {
  return value.toFixed(4).replace('-', '−');
}

export function formatRadius(radiusM: number): string {
  return `${radiusM} m`;
}
