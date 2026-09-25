'use client';

import type { GpsFix } from '../useGeoFix';

/**
 * The shift screen's map (§5.1, §9.11; wireframe shift-detail.html (a)(b)(c)(h)):
 * the venue pin, the geofence circle and — once the device has a fix —
 * the worker's own position, "you".
 *
 * A schematic, not tiles: the wireframe draws exactly this, and what the
 * worker needs from it is whether "you" is inside the circle and which way
 * to walk. The circle's radius is fixed on screen and the metres scale to
 * it, so a 150 m and a 400 m geofence read the same; a worker further away
 * than the surface is pinned to its edge in the right direction, with the
 * distance said in words by the GPS chip beside it (the accessible text).
 */
const CIRCLE_PX = 45;

export function GeofenceMap({
  venue,
  radiusM,
  fix,
  label,
  height = 150,
}: {
  venue: { lat: number; lng: number };
  radiusM: number;
  fix: GpsFix | null;
  /** "Park Lane · geofence 150 m" */
  label: string;
  height?: number;
}) {
  const me = fix ? place(venue, radiusM, fix, height) : null;
  return (
    <div className="geo-map" style={{ height }} role="img" aria-label={label}>
      <div
        className="circle"
        style={{ left: '50%', top: '50%', width: CIRCLE_PX * 2, height: CIRCLE_PX * 2 }}
      />
      <div className="pin" style={{ left: '50%', top: '50%' }} />
      {me ? (
        <>
          <div className="me" style={{ left: `${me.x}%`, top: `${me.y}%` }} />
          <div className="lbl you" style={{ left: `${me.x}%`, top: `${me.y}%` }}>
            you
          </div>
        </>
      ) : null}
      <div className="lbl" style={{ left: 8, top: 8 }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Where "you" sits, as percentages of the surface. Equirectangular is
 * plenty at geofence scale; the clamp keeps a far-away fix on the edge
 * rather than off the map.
 */
export function place(
  venue: { lat: number; lng: number },
  radiusM: number,
  fix: { lat: number; lng: number },
  height: number,
  width = 360,
): { x: number; y: number } {
  const metresPerDegLat = 111_320;
  const metresPerDegLng = 111_320 * Math.cos((venue.lat * Math.PI) / 180);
  const pxPerMetre = CIRCLE_PX / Math.max(radiusM, 1);
  let dx = (fix.lng - venue.lng) * metresPerDegLng * pxPerMetre;
  let dy = -(fix.lat - venue.lat) * metresPerDegLat * pxPerMetre;
  const maxX = width / 2 - 12;
  const maxY = height / 2 - 12;
  const over = Math.max(Math.abs(dx) / maxX, Math.abs(dy) / maxY, 1);
  dx /= over;
  dy /= over;
  return {
    x: Math.round((50 + (dx / width) * 100) * 10) / 10,
    y: Math.round((50 + (dy / height) * 100) * 10) / 10,
  };
}
