import { describe, expect, it } from 'vitest';
import { dayLabel, mapLayout, meterFill, weekLabel } from '../model';

describe('the week labels (§10.4, radar.html)', () => {
  it('"Mon 14" for a Monday', () => {
    expect(dayLabel('2026-09-14')).toBe('Mon 14');
  });

  it('"Mon 14 – Sun 20" for the strip', () => {
    expect(weekLabel('2026-09-14', '2026-09-20')).toBe('Mon 14 – Sun 20');
  });
});

describe('meterFill — how full the RULE-20 bar is', () => {
  it('8 h of 20 h is 40%, and within the cap', () => {
    expect(meterFill(8, 20)).toEqual({ total: 8, percent: 40, over: false });
  });

  it('"with this shift": 18 h + 4 h against 20 h is over, and the bar is full', () => {
    expect(meterFill(18, 20, 4)).toEqual({ total: 22, percent: 100, over: true });
  });

  it('8 h + 5 h against 20 h is 13 h, 65%, green', () => {
    expect(meterFill(8, 20, 5)).toEqual({ total: 13, percent: 65, over: false });
  });

  it('exactly at the cap is not over', () => {
    expect(meterFill(16, 20, 4).over).toBe(false);
  });

  it('no ceiling is an empty bar, not a breached one', () => {
    expect(meterFill(30, null)).toEqual({ total: 30, percent: 0, over: false });
  });

  it('rounds to a tenth of an hour, like explainLimit', () => {
    expect(meterFill(7.25, 20, 0.5).total).toBe(7.8);
  });
});

describe('mapLayout — venue, geofence and home on the ADR-0005 surface', () => {
  const venue = { lat: 51.513, lng: -0.099 };
  const frame = { width: 342, height: 120 };

  it('with no home pin the venue sits centred and the circle is readable', () => {
    const layout = mapLayout({ venue, home: null, radiusM: 150, ...frame });
    expect(layout.pin).toEqual({ x: 50, y: 50 });
    expect(layout.me).toBeNull();
    expect(layout.circle.d).toBeGreaterThanOrEqual(24);
  });

  it('home to the north-east lands right of and above the venue, both inside the frame', () => {
    const layout = mapLayout({ venue, home: { lat: 51.53, lng: -0.05 }, radiusM: 150, ...frame });
    expect(layout.me).not.toBeNull();
    expect(layout.me!.x).toBeGreaterThan(layout.pin.x);
    expect(layout.me!.y).toBeLessThan(layout.pin.y);
    for (const p of [layout.pin, layout.me!]) {
      expect(p.x).toBeGreaterThan(10);
      expect(p.x).toBeLessThan(90);
      expect(p.y).toBeGreaterThan(10);
      expect(p.y).toBeLessThan(90);
    }
  });

  it('the pair is framed about the centre', () => {
    const layout = mapLayout({ venue, home: { lat: 51.53, lng: -0.05 }, radiusM: 150, ...frame });
    expect((layout.pin.x + layout.me!.x) / 2).toBeCloseTo(50, 5);
    expect((layout.pin.y + layout.me!.y) / 2).toBeCloseTo(50, 5);
  });

  it('the geofence is drawn to the same scale as the pins, floored so it stays visible', () => {
    const near = mapLayout({ venue, home: { lat: 51.514, lng: -0.098 }, radiusM: 150, ...frame });
    const far = mapLayout({ venue, home: { lat: 51.6, lng: 0.1 }, radiusM: 150, ...frame });
    expect(near.circle.d).toBeGreaterThan(far.circle.d);
    expect(far.circle.d).toBeGreaterThanOrEqual(6);
    expect(near.circle.d).toBeLessThanOrEqual(120);
    expect(near.circle.x).toBe(near.pin.x);
  });
});
