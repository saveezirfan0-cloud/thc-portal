import { describe, expect, it } from 'vitest';
import {
  MAX_RADIUS_M,
  METRES_PER_DEGREE_LAT,
  MIN_RADIUS_M,
  clampRadius,
  distanceMetres,
  fitCircles,
  formatCoordinates,
  formatRadius,
  metresPerPixel,
  project,
  radiusInPixels,
  scaleBar,
  unproject,
  wrapLongitude,
  zoomForRadius,
} from '../geo';

/**
 * The Venues map (§9.11) decides two things a manager acts on: where the pin
 * is, and how big the geofence circle is. Both come out of the projection
 * below, so they are tested here rather than through the screen.
 *
 * Coordinates are the wireframe's own (`wireframes/backoffice/venues.html`),
 * which is also what supabase/seed.sql loads.
 */
const LEONARDO_ROYAL = { lat: 51.5133, lng: -0.099 };
const EXCEL = { lat: 51.5081, lng: 0.0294 };
const EPSOM = { lat: 51.3113, lng: -0.2586 };

describe('the Web Mercator projection', () => {
  it('puts Greenwich on the middle meridian of the world plane', () => {
    const { x } = project({ lat: 51.4779, lng: 0 }, 10);
    expect(x).toBeCloseTo((256 * 2 ** 10) / 2, 6);
  });

  it('round-trips every venue in the seed data', () => {
    for (const point of [LEONARDO_ROYAL, EXCEL, EPSOM]) {
      for (const zoom of [3, 11, 16, 19]) {
        const back = unproject(project(point, zoom), zoom);
        expect(back.lat).toBeCloseTo(point.lat, 9);
        expect(back.lng).toBeCloseTo(point.lng, 9);
      }
    }
  });

  it('halves the metres a pixel covers with every zoom level', () => {
    const at12 = metresPerPixel(LEONARDO_ROYAL.lat, 12);
    const at13 = metresPerPixel(LEONARDO_ROYAL.lat, 13);
    expect(at13).toBeCloseTo(at12 / 2, 9);
  });

  it('agrees with the great-circle distance about how wide a circle is', () => {
    // A 500 m circle drawn from `radiusInPixels` must cover the point that
    // is genuinely 500 m north of the pin — otherwise a worker standing
    // inside the geofence would be drawn outside it.
    const zoom = 15;
    const pin = LEONARDO_ROYAL;
    const northEdge = { lat: pin.lat + 500 / METRES_PER_DEGREE_LAT, lng: pin.lng };
    expect(distanceMetres(pin, northEdge)).toBeCloseTo(500, 0);

    const pinPx = project(pin, zoom);
    const edgePx = project(northEdge, zoom);
    expect(pinPx.y - edgePx.y).toBeCloseTo(radiusInPixels(500, pin.lat, zoom), 0);
  });

  it('wraps longitudes back into range rather than drifting past the date line', () => {
    expect(wrapLongitude(-0.099)).toBeCloseTo(-0.099, 9);
    expect(wrapLongitude(181)).toBeCloseTo(-179, 9);
    expect(wrapLongitude(-181)).toBeCloseTo(179, 9);
  });

  it('clamps beyond the Mercator poles instead of returning infinity', () => {
    const north = project({ lat: 89.9, lng: 0 }, 10);
    expect(Number.isFinite(north.y)).toBe(true);
    expect(unproject(north, 10).lat).toBeLessThan(85.06);
  });
});

describe('the geofence radius (§9.11: slider 100–3000 m)', () => {
  it('holds the slider range wherever the number came from', () => {
    expect(clampRadius(50)).toBe(MIN_RADIUS_M);
    expect(clampRadius(4000)).toBe(MAX_RADIUS_M);
    expect(clampRadius(250)).toBe(250);
    expect(clampRadius(250.4)).toBe(250);
  });

  it('grows the circle with the radius at a fixed zoom', () => {
    const small = radiusInPixels(100, LEONARDO_ROYAL.lat, 14);
    const large = radiusInPixels(3000, LEONARDO_ROYAL.lat, 14);
    expect(large / small).toBeCloseTo(30, 6);
  });

  it('frames a single circle so the whole thing is on screen', () => {
    const viewport = { width: 800, height: 300 };
    for (const radius of [100, 250, 500, 1500, 3000]) {
      const zoom = zoomForRadius(radius, LEONARDO_ROYAL.lat, viewport);
      expect(Number.isInteger(zoom)).toBe(true);
      const diameterPx = radiusInPixels(radius, LEONARDO_ROYAL.lat, zoom) * 2;
      expect(diameterPx).toBeLessThanOrEqual(Math.min(viewport.width, viewport.height));
      expect(diameterPx).toBeGreaterThan(0);
    }
  });
});

describe('framing the "On map" tab', () => {
  const circles = [
    { ...LEONARDO_ROYAL, radiusM: 150 },
    { ...EXCEL, radiusM: 400 },
    { ...EPSOM, radiusM: 1500 },
  ];

  it('fits every venue, circle included, inside the viewport', () => {
    const viewport = { width: 1200, height: 620 };
    const { centre, zoom } = fitCircles(circles, viewport);

    const originX = project(centre, zoom).x - viewport.width / 2;
    const originY = project(centre, zoom).y - viewport.height / 2;

    for (const circle of circles) {
      const at = project(circle, zoom);
      const r = radiusInPixels(circle.radiusM, circle.lat, zoom);
      expect(at.x - originX - r).toBeGreaterThanOrEqual(0);
      expect(at.x - originX + r).toBeLessThanOrEqual(viewport.width);
      expect(at.y - originY - r).toBeGreaterThanOrEqual(0);
      expect(at.y - originY + r).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('falls back to London when there is nothing to fit', () => {
    const { centre, zoom } = fitCircles([], { width: 1200, height: 620 });
    expect(centre.lat).toBeCloseTo(51.5074, 4);
    expect(zoom).toBe(11);
  });
});

describe('the scale bar', () => {
  it('never draws longer than the space it is given', () => {
    for (const zoom of [8, 11, 14, 17]) {
      const bar = scaleBar(LEONARDO_ROYAL.lat, zoom, 120);
      expect(bar.px).toBeLessThanOrEqual(120);
      expect(bar.label).toMatch(/^\d+(\.\d+)? (m|km)$/);
    }
  });
});

describe('the formats the wireframe prints', () => {
  it('prints coordinates with four decimals and a real minus sign', () => {
    // The wireframe's own row: "51.5133, −0.0990" (U+2212, not a hyphen).
    expect(formatCoordinates(LEONARDO_ROYAL)).toBe('51.5133, −0.0990');
    expect(formatCoordinates(EXCEL)).toBe('51.5081, 0.0294');
  });

  it('prints a radius the way the slider reads it', () => {
    expect(formatRadius(150)).toBe('150 m');
    expect(formatRadius(3000)).toBe('3000 m');
  });
});
