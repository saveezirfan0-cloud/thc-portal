import { describe, expect, it } from 'vitest';
import { MAP_MIN_ZOOM, layoutShiftMap, metresPerPixel } from '../map';

/**
 * The shift screen's map (ADR-0005's approach): the geofence to scale, the
 * venue centre, and the worker. Pure layout, so what lands where is tested
 * without a browser.
 */
const venue = { lat: 51.5136, lng: -0.0984 }; // Godliman St, EC4
const size = { width: 360, height: 160 };

describe('layoutShiftMap()', () => {
  it('centres the venue and draws the circle to scale when there is no fix', () => {
    const map = layoutShiftMap({ venue, radiusM: 150, me: null, ...size });
    expect(map.venue.x).toBeCloseTo(180, 0);
    expect(map.venue.y).toBeCloseTo(80, 0);
    expect(map.radiusPx).toBeCloseTo(150 / metresPerPixel(venue.lat, map.zoom), 5);
    // The whole circle is in shot.
    expect(map.radiusPx * 2).toBeLessThanOrEqual(size.height);
    expect(map.me).toBeNull();
  });

  it('puts a worker on site inside the circle', () => {
    const me = { lat: venue.lat + 0.0002, lng: venue.lng + 0.0002 }; // ~26 m
    const map = layoutShiftMap({ venue, radiusM: 150, me, ...size });
    expect(map.me?.offMap).toBe(false);
    const dx = map.me!.x - map.venue.x;
    const dy = map.me!.y - map.venue.y;
    expect(Math.hypot(dx, dy)).toBeLessThan(map.radiusPx);
  });

  it('frames both the circle and a worker 1.8 km away, the worker outside it', () => {
    const me = { lat: venue.lat - 0.012, lng: venue.lng - 0.02 };
    const map = layoutShiftMap({ venue, radiusM: 150, me, ...size });
    expect(map.me?.offMap).toBe(false);
    expect(map.me!.x).toBeGreaterThanOrEqual(0);
    expect(map.me!.x).toBeLessThanOrEqual(size.width);
    const dx = map.me!.x - map.venue.x;
    const dy = map.me!.y - map.venue.y;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(map.radiusPx);
  });

  it('pins a worker too far away to the edge, on the bearing towards them', () => {
    const me = { lat: 53.48, lng: -2.24 }; // Manchester
    const map = layoutShiftMap({ venue, radiusM: 150, me, ...size });
    expect(map.me?.offMap).toBe(true);
    expect(map.zoom).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
    // North-west of London: up and to the left of the venue.
    expect(map.me!.x).toBeLessThan(map.venue.x);
    expect(map.me!.y).toBeLessThan(map.venue.y);
  });

  it('keeps a 3 km geofence in shot', () => {
    const map = layoutShiftMap({ venue, radiusM: 3000, me: null, ...size });
    expect(map.radiusPx * 2).toBeLessThanOrEqual(size.height);
  });
});
