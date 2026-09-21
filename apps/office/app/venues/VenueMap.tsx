'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useAppearance } from '@thc/ui';
import {
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  clampZoom,
  fitCircles,
  formatRadius,
  project,
  radiusInPixels,
  scaleBar,
  unproject,
} from './geo';
import type { Circle, LatLng, Point, Viewport } from './geo';

export interface VenueMarker extends Circle {
  id: string;
  /** Printed beside the pin, e.g. "Leonardo Royal · 150 m". */
  label?: string;
}

export interface VenueMapProps {
  markers: VenueMarker[];
  /**
   * Which of the wireframe's two maps this is: the full-width 620 px one on
   * the "On map" tab, or the 300 px one at the top of the modal. The height
   * belongs to the stylesheet so that the narrow-screen rules can shrink it.
   */
  variant: 'tab' | 'modal';
  /**
   * Edit mode (§9.11): clicking the surface drops the pin, dragging the pin
   * moves it. The circle still follows the slider, never the mouse.
   */
  editable?: boolean;
  onMovePin?: (point: LatLng) => void;
  onSelectMarker?: (id: string) => void;
  /** Changing this re-frames the view. Pass the radius so the circle stays in shot. */
  refitKey?: string;
  ariaLabel: string;
  legend?: boolean;
  hint?: string;
}

/**
 * The Venues map (§9.11).
 *
 * A Web Mercator surface drawn on the design system's `.map` token
 * background, so it reads as a map with or without a tile provider. When
 * `NEXT_PUBLIC_MAPBOX_TOKEN` is set the raster tiles for the current
 * appearance are laid over that background; without one, the grid and the
 * scale bar still place every pin and size every geofence correctly,
 * because the projection — not the tiles — is what positions them.
 *
 * Zoom is whole levels only, moved with the +/− controls (and a
 * double-click), never with the wheel: this map is full width, and hijacking
 * the page scroll over it would trap a manager scrolling past.
 */
export function VenueMap({
  markers,
  variant,
  editable,
  onMovePin,
  onSelectMarker,
  refitKey,
  ariaLabel,
  legend,
  hint,
}: VenueMapProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [view, setView] = useState<{ centre: LatLng; zoom: number } | null>(null);
  const { mode } = useAppearance();

  // The surface is full width, so the fit depends on the measured size.
  // A new object on every observer tick would re-frame the map while the
  // manager is panning, so an unchanged size keeps the same object.
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () =>
      setViewport((current) =>
        current.width === element.clientWidth && current.height === element.clientHeight
          ? current
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Read by the framing effect below, which must NOT re-run when the parent
  // rebuilds the array — only when the size or `refitKey` changes.
  const latestMarkers = useRef(markers);
  latestMarkers.current = markers;

  // Frame the markers once the size is known, and again whenever the caller
  // says WHAT is framed changed — the tab's set of venues, or the modal's
  // pin being dropped for the first time. Never on a radius change: that is
  // the effect below, and it only nudges the zoom.
  useEffect(() => {
    if (viewport.width === 0) return;
    const current = latestMarkers.current;
    setView(
      current.length > 0
        ? fitCircles(current, viewport)
        : { centre: DEFAULT_CENTRE, zoom: DEFAULT_ZOOM },
    );
  }, [viewport, refitKey]);

  /**
   * §9.11 wants the circle to change with the slider, so the manager can
   * see it cover the whole site. Re-framing on every radius change would
   * cancel exactly that out — the circle would stay the same size on screen
   * and only the scale bar would move. So the view gives way only at the
   * edges: it zooms out when the circle would run off the map, and back in
   * when it has shrunk to a dot. Between those, the circle simply grows.
   *
   * This is the modal's single pin only. The "On map" tab is framed by
   * `fitCircles`, which already has every circle in shot, and zooming in on
   * the widest of them there would push the furthest venue off the map.
   */
  const radiiKey = markers.map((marker) => marker.radiusM).join(',');

  useEffect(() => {
    if (viewport.width === 0) return;
    const shorter = Math.min(viewport.width, viewport.height);
    setView((current) => {
      if (!current) return current;
      const ms = latestMarkers.current;
      const only = ms.length === 1 ? ms[0] : undefined;
      if (!only) return current;
      const diameter = (at: number) => radiusInPixels(only.radiusM, only.lat, at) * 2;

      let zoom = current.zoom;
      while (zoom > MIN_ZOOM && diameter(zoom) > shorter * 0.92) zoom -= 1;
      while (zoom < MAX_ZOOM && diameter(zoom) < shorter * 0.1) zoom += 1;
      return zoom === current.zoom ? current : { ...current, zoom };
    });
  }, [radiiKey, viewport]);

  const centre = view?.centre ?? DEFAULT_CENTRE;
  const zoom = view?.zoom ?? DEFAULT_ZOOM;

  /** World-pixel coordinate of the viewport's top-left corner. */
  const origin = useMemo<Point>(() => {
    const centrePx = project(centre, zoom);
    return { x: centrePx.x - viewport.width / 2, y: centrePx.y - viewport.height / 2 };
  }, [centre, zoom, viewport.width, viewport.height]);

  const toScreen = useCallback(
    (point: LatLng): Point => {
      const world = project(point, zoom);
      return { x: world.x - origin.x, y: world.y - origin.y };
    },
    [origin, zoom],
  );

  const toLatLng = useCallback(
    (screen: Point): LatLng => unproject({ x: screen.x + origin.x, y: screen.y + origin.y }, zoom),
    [origin, zoom],
  );

  const setZoom = useCallback((next: number) => {
    setView((current) => ({
      centre: current?.centre ?? DEFAULT_CENTRE,
      zoom: clampZoom(next),
    }));
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    setView((current) => {
      const from = current ?? { centre: DEFAULT_CENTRE, zoom: DEFAULT_ZOOM };
      const centrePx = project(from.centre, from.zoom);
      return {
        zoom: from.zoom,
        centre: unproject({ x: centrePx.x + dx, y: centrePx.y + dy }, from.zoom),
      };
    });
  }, []);

  // ---- pointer handling -------------------------------------------------
  // Two gestures share the surface: dragging the background pans, and (in
  // edit mode) dragging the pin moves it. A press that never moves is a
  // click, which drops the pin.
  const drag = useRef<{ kind: 'pan' | 'pin'; x: number; y: number; moved: boolean } | null>(null);

  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = surface.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, kind: 'pan' | 'pin') => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    active.moved = true;
    active.x = event.clientX;
    active.y = event.clientY;
    if (active.kind === 'pan') panBy(-dx, -dy);
    else onMovePin?.(toLatLng(localPoint(event)));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active || active.moved) return;
    if (active.kind === 'pan' && editable) onMovePin?.(toLatLng(localPoint(event)));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 120 : 40;
    const pans: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const pan = pans[event.key];
    if (pan) {
      event.preventDefault();
      panBy(pan[0], pan[1]);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(zoom + 1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setZoom(zoom - 1);
    }
  };

  // ---- raster tiles, when a provider is configured ----------------------
  const tiles = useTiles(origin, zoom, viewport, mode);

  const placed = useMemo(
    () => layOut(markers, toScreen, zoom, viewport),
    [markers, toScreen, zoom, viewport],
  );

  const bar = scaleBar(centre.lat, zoom);
  const pinnable = editable && markers.length > 0;

  return (
    <div
      ref={surface}
      className={variant === 'tab' ? 'map venue-map big' : 'map venue-map compact'}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => startDrag(event, 'pan')}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setZoom(zoom + 1)}
      data-editable={editable ? 'true' : undefined}
    >
      {tiles.map((tile) => (
        <img
          key={tile.key}
          className="tile"
          src={tile.url}
          alt=""
          draggable={false}
          style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {placed.map(({ marker, at, r, label }) => {
        const interactive = !editable && onSelectMarker;
        return (
          <span key={marker.id}>
            <span
              className="circle"
              style={{ left: at.x, top: at.y, width: r * 2, height: r * 2 }}
            />
            {interactive ? (
              <button
                type="button"
                className="pin pin-button"
                style={{ left: at.x, top: at.y }}
                aria-label={`Edit ${marker.label ?? marker.id}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSelectMarker(marker.id)}
              />
            ) : (
              <span
                className="pin"
                style={{ left: at.x, top: at.y, cursor: pinnable ? 'grab' : undefined }}
                onPointerDown={
                  pinnable
                    ? (event) => {
                        event.stopPropagation();
                        startDrag(event, 'pin');
                      }
                    : undefined
                }
              />
            )}
            {label ? (
              <span className="lbl name" style={{ left: at.x + 10, top: at.y + r + 6 }}>
                {marker.label}
              </span>
            ) : null}
          </span>
        );
      })}

      {hint ? (
        <span className="lbl" style={{ left: 12, top: 12 }}>
          {hint}
        </span>
      ) : null}

      {/* The controls sit inside the surface, so their presses must not
          reach it: in edit mode a press on the surface drops the pin. */}
      <div className="ctrl" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom(zoom + 1)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom(zoom - 1)}
        >
          −
        </button>
      </div>

      {legend ? (
        <div className="legend">
          <span>
            <b>●</b> pin
          </span>
          <span>
            <b>○</b> geofence circle, to scale
          </span>
          <span>zoom to compare sizes</span>
        </div>
      ) : null}

      <div className="scale" aria-hidden="true">
        <i style={{ width: bar.px }} />
        <span>{bar.label}</span>
      </div>
    </div>
  );
}

interface PlacedMarker {
  marker: VenueMarker;
  at: Point;
  r: number;
  /** False when another pin's label already occupies this space. */
  label: boolean;
}

/** A label's rough on-screen box. `.lbl.name` is 11 px, one line, nowrap. */
const LABEL_HEIGHT = 18;
const LABEL_CHAR_WIDTH = 6.2;

/**
 * Places the pins and decides which of them may print a label.
 *
 * On the "On map" tab every venue is on screen at once, and in a city the
 * pins land on top of each other. Rather than draw ten labels over one
 * another — which is what makes such a map unreadable — the widest geofence
 * in any cluster keeps its label and the rest go quiet until the manager
 * zooms in, which is exactly what the legend invites them to do.
 *
 * Markers whose circle is entirely off screen are dropped: nothing to draw.
 */
function layOut(
  markers: VenueMarker[],
  toScreen: (point: LatLng) => Point,
  zoom: number,
  viewport: Viewport,
): PlacedMarker[] {
  const visible = markers
    .map((marker) => ({
      marker,
      at: toScreen(marker),
      r: radiusInPixels(marker.radiusM, marker.lat, zoom),
    }))
    .filter(
      ({ at, r }) =>
        at.x + r >= 0 && at.x - r <= viewport.width && at.y + r >= 0 && at.y - r <= viewport.height,
    );

  // Biggest geofence first, so the venue whose radius dominates a cluster is
  // the one that keeps its name.
  const order = [...visible].sort((a, b) => b.r - a.r);
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const labelled = new Set<string>();

  for (const entry of order) {
    const text = entry.marker.label;
    if (!text) continue;
    const box = {
      x: entry.at.x + 10,
      y: entry.at.y + entry.r + 6,
      w: text.length * LABEL_CHAR_WIDTH + 12,
      h: LABEL_HEIGHT,
    };
    const clashes = taken.some(
      (other) =>
        box.x < other.x + other.w &&
        box.x + box.w > other.x &&
        box.y < other.y + other.h &&
        box.y + box.h > other.y,
    );
    if (clashes) continue;
    taken.push(box);
    labelled.add(entry.marker.id);
  }

  // Widest first, so a large circle is painted behind the pins inside it.
  return order.map((entry) => ({ ...entry, label: labelled.has(entry.marker.id) }));
}

interface Tile {
  key: string;
  url: string;
  left: number;
  top: number;
}

/**
 * Raster tiles from Mapbox (docs/01-architecture.md picked it; the token is
 * already in turbo.json's pass-through list). No client library: at whole
 * zoom levels a 256 px tile grid is four lines of arithmetic, and a map
 * library would be a dependency the rest of the repo does not carry yet.
 * With no token the list is empty and the `.map` grid shows through.
 */
function useTiles(origin: Point, zoom: number, viewport: Viewport, mode: 'light' | 'dark'): Tile[] {
  return useMemo(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || viewport.width === 0) return [];

    const style = mode === 'dark' ? 'dark-v11' : 'light-v11';
    const count = 2 ** zoom;
    const out: Tile[] = [];

    const firstX = Math.floor(origin.x / TILE_SIZE);
    const lastX = Math.floor((origin.x + viewport.width) / TILE_SIZE);
    const firstY = Math.floor(origin.y / TILE_SIZE);
    const lastY = Math.floor((origin.y + viewport.height) / TILE_SIZE);

    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        if (y < 0 || y >= count) continue; // past a pole: nothing to draw
        const wrapped = ((x % count) + count) % count; // the world repeats east–west
        out.push({
          key: `${zoom}/${x}/${y}`,
          url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/256/${zoom}/${wrapped}/${y}@2x?access_token=${token}`,
          left: x * TILE_SIZE - origin.x,
          top: y * TILE_SIZE - origin.y,
        });
      }
    }
    return out;
  }, [origin, zoom, viewport.width, viewport.height, mode]);
}

/** The "On map" tab's pin label: the venue's name and how wide its geofence is. */
export function markerLabel(name: string, radiusM: number): string {
  return `${name} · ${formatRadius(radiusM)}`;
}
