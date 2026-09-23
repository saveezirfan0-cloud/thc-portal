import { describe, expect, it } from 'vitest';
import { TILE_SIZE, clampZoom, panBy, project, unproject, visibleTiles } from '../geo';

describe('Web Mercator for the home pin', () => {
  const home = { lat: 51.529, lng: -0.045 };

  it('round-trips a point', () => {
    const back = unproject(project(home, 16), 16);
    expect(back.lat).toBeCloseTo(home.lat, 9);
    expect(back.lng).toBeCloseTo(home.lng, 9);
  });

  it('puts 0,0 in the middle of the world', () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
  });

  it('dragging the map right moves the centre west (the map moves, the pin stays)', () => {
    const next = panBy(home, 16, 100, 0);
    expect(next.lng).toBeLessThan(home.lng);
    expect(next.lat).toBeCloseTo(home.lat, 9);
  });

  it('dragging down moves the centre north', () => {
    expect(panBy(home, 16, 0, 100).lat).toBeGreaterThan(home.lat);
  });

  it('covers the viewport with whole tiles', () => {
    const tiles = visibleTiles(home, 15, 390, 250);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    for (const t of tiles) {
      expect(t.left).toBeLessThan(390);
      expect(t.left + TILE_SIZE).toBeGreaterThan(0);
      expect(t.top).toBeLessThan(250);
      expect(t.top + TILE_SIZE).toBeGreaterThan(0);
    }
  });

  it('keeps zoom to whole levels in range', () => {
    expect(clampZoom(40)).toBe(19);
    expect(clampZoom(0)).toBe(5);
    expect(clampZoom(15.4)).toBe(15);
  });
});
