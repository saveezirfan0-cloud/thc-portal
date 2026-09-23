'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button, useAppearance } from '@thc/ui';
import { clampZoom, DEFAULT_ZOOM, panBy, roundCoord, visibleTiles } from '../geo';
import type { LatLng } from '../geo';

/**
 * The home pin (§10.3 2/11). The pin stays in the middle and the map moves
 * under it — the usual phone gesture for "put the pin on my door", and one
 * that needs no hit-testing on a 22 px target under a thumb.
 *
 * Mapbox raster tiles are drawn when NEXT_PUBLIC_MAPBOX_TOKEN is set
 * (ADR-0005); without one the design system's map ground and the maths
 * still place the pin exactly, which is what the database stores.
 */
const TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

export function PinMap({
  centre,
  onMove,
  onLocate,
  locating,
}: {
  centre: LatLng;
  onMove: (p: LatLng) => void;
  onLocate: () => void;
  locating: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const drag = useRef<{ x: number; y: number; from: LatLng } | null>(null);
  const { mode } = useAppearance();

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: centre };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = panBy(d.from, zoom, e.clientX - d.x, e.clientY - d.y);
    onMove({ lat: roundCoord(next.lat), lng: roundCoord(next.lng) });
  };
  const up = () => {
    drag.current = null;
  };

  const style = mode === 'dark' ? 'dark-v11' : 'light-v11';
  const tiles = TOKEN && size.width > 0 ? visibleTiles(centre, zoom, size.width, size.height) : [];

  return (
    <div
      ref={surface}
      className="pin-map"
      role="application"
      aria-label="Map — move it so the pin is on your front door"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {tiles.map((t) => (
        <img
          key={`${t.z}/${t.x}/${t.y}/${t.left}`}
          className="tile"
          alt=""
          draggable={false}
          src={`https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/256/${t.z}/${t.x}/${t.y}?access_token=${TOKEN}`}
          style={{ left: t.left, top: t.top }}
        />
      ))}
      <span className="pin" aria-hidden="true" />
      <span className="hint-lbl">move the map to put the pin on your front door</span>
      <div className="controls" onPointerDown={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => setZoom((z) => clampZoom(z - 1))} aria-label="Zoom out">
          −
        </Button>
        <Button size="sm" onClick={() => setZoom((z) => clampZoom(z + 1))} aria-label="Zoom in">
          +
        </Button>
        <Button size="sm" onClick={onLocate} disabled={locating}>
          {locating ? 'Locating…' : '◎ Use my location'}
        </Button>
      </div>
    </div>
  );
}
