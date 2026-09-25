'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '@thc/ui';
import { visibleTiles } from '../../onboarding/geo';
import type { LatLng } from '../../onboarding/geo';
import { layoutShiftMap } from './map';

/**
 * The venue, its geofence and the worker — `wireframes/staff/shift-detail.html`
 * (a) before the day, (b) out of radius, (c) in radius, (h) check-out.
 *
 * Schematic by design (ADR-0005): the design system's map ground, the
 * circle to scale, the venue centre and a dot for the worker, positioned by
 * the Web Mercator maths in `map.ts`. Raster tiles go underneath only when
 * `NEXT_PUBLIC_MAPBOX_TOKEN` is set. Nothing pans or zooms: this map
 * answers one question — am I inside the circle — and the distance line
 * under it says the same in words.
 */
const TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];

export function ShiftMap({
  venue,
  radiusM,
  me,
  label,
  tall,
}: {
  venue: LatLng;
  radiusM: number;
  me: LatLng | null;
  /** "Geofence 150 m", top left, as in the wireframe. */
  label: string;
  /** The live check-in map is taller than the before-the-day one. */
  tall?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { mode } = useAppearance();

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () =>
      setSize((s) =>
        s.width === el.clientWidth && s.height === el.clientHeight
          ? s
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ready = size.width > 0 && size.height > 0;
  const layout = ready
    ? layoutShiftMap({ venue, radiusM, me, width: size.width, height: size.height })
    : null;
  const style = mode === 'dark' ? 'dark-v11' : 'light-v11';
  const tiles =
    TOKEN && layout ? visibleTiles(layout.centre, layout.zoom, size.width, size.height) : [];

  return (
    <div
      ref={surface}
      className={tall ? 'shift-map tall' : 'shift-map'}
      role="img"
      aria-label={
        me
          ? `Map of the venue’s ${radiusM} m check-in area and your position`
          : `Map of the venue’s ${radiusM} m check-in area`
      }
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
      {layout ? (
        <>
          <span
            className="circle"
            style={{
              left: layout.venue.x,
              top: layout.venue.y,
              width: layout.radiusPx * 2,
              height: layout.radiusPx * 2,
            }}
          />
          <span className="pin" style={{ left: layout.venue.x, top: layout.venue.y }} />
          {layout.me ? (
            <>
              <span
                className={layout.me.offMap ? 'me off' : 'me'}
                style={{ left: layout.me.x, top: layout.me.y }}
              />
              <span className="lbl you" style={{ left: layout.me.x, top: layout.me.y + 8 }}>
                {layout.me.offMap ? 'you — off the map' : 'you'}
              </span>
            </>
          ) : null}
        </>
      ) : null}
      <span className="lbl" style={{ left: 8, top: 8 }}>
        {label}
      </span>
    </div>
  );
}
