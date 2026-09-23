/**
 * Web Mercator for the home-address pin (§10.3 2/11).
 *
 * The same few lines of maths ADR-0005 put behind the office's venue map,
 * for the same reason: no GL library, a map that positions the pin
 * correctly with or without a tile provider, and raster tiles laid on top
 * when NEXT_PUBLIC_MAPBOX_TOKEN is set. The office's copy lives in
 * apps/office and an app cannot import another app, so the two formulas
 * are repeated here with their own tests.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 19;
/** Central London — where most THC workers live, and a sensible first view. */
export const DEFAULT_CENTRE = { lat: 51.5074, lng: -0.1278 } as const;
export const DEFAULT_ZOOM = 15;

export interface LatLng {
  lat: number;
  lng: number;
}
export interface Point {
  x: number;
  y: number;
}

const MAX_LAT = 85.05112878;

/** World-pixel coordinate of a point at a zoom level. */
export function project(p: LatLng, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((p.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(pt: Point, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (pt.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * pt.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
}

/** The centre after dragging the map by (dx, dy) screen pixels. */
export function panBy(centre: LatLng, zoom: number, dx: number, dy: number): LatLng {
  const c = project(centre, zoom);
  return unproject({ x: c.x - dx, y: c.y - dy }, zoom);
}

export interface Tile {
  x: number;
  y: number;
  z: number;
  /** Screen position of the tile's top-left corner. */
  left: number;
  top: number;
}

/** The tiles that cover a viewport centred on `centre`. */
export function visibleTiles(centre: LatLng, zoom: number, width: number, height: number): Tile[] {
  const c = project(centre, zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const count = 2 ** zoom;
  const tiles: Tile[] = [];
  for (
    let ty = Math.floor(originY / TILE_SIZE);
    ty <= Math.floor((originY + height) / TILE_SIZE);
    ty++
  ) {
    if (ty < 0 || ty >= count) continue;
    for (
      let tx = Math.floor(originX / TILE_SIZE);
      tx <= Math.floor((originX + width) / TILE_SIZE);
      tx++
    ) {
      tiles.push({
        x: ((tx % count) + count) % count,
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** Five decimal places is about a metre — plenty for a front door. */
export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
