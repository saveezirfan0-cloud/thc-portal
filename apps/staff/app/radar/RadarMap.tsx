import { formatDistance } from '@thc/domain';
import type { OpenShift } from '../data';
import { mapLayout } from './model';

/** The block's size in the wireframe (radar.html: `height:120px`, full width). */
const WIDTH = 342;
const HEIGHT = 120;

/**
 * The venue map on an open shift — wireframes/staff/radar.html, ADR-0005.
 *
 * Venue pin, its geofence circle to scale, the worker's home pin, and the
 * "1.2 km from home" label the km badge already carries. Server-rendered
 * markup on the design system's `.map` surface: nothing here needs a
 * client library, and the same block renders on a preview deploy with no
 * map token.
 *
 * Null where the row has no venue pin — an older `staff_open_shifts()`
 * body, or an event whose venue location was never set — because a map
 * with nothing on it says less than no map.
 */
export function RadarMap({
  shift,
}: {
  /** An open shift, or an offered one (`/radar/offers/:id`, ADR-0039). */
  shift: Pick<
    OpenShift,
    'distanceKm' | 'geofenceRadiusM' | 'homeLat' | 'homeLng' | 'venueLat' | 'venueLng' | 'venueName'
  >;
}) {
  if (shift.venueLat === null || shift.venueLng === null) return null;
  const home =
    shift.homeLat !== null && shift.homeLng !== null
      ? { lat: shift.homeLat, lng: shift.homeLng }
      : null;
  const layout = mapLayout({
    venue: { lat: shift.venueLat, lng: shift.venueLng },
    home,
    radiusM: shift.geofenceRadiusM,
    width: WIDTH,
    height: HEIGHT,
  });

  return (
    <div className="map radar-map" role="img" aria-label={`Map of ${shift.venueName}`}>
      <div
        className="circle"
        style={{
          left: `${layout.circle.x}%`,
          top: `${layout.circle.y}%`,
          width: layout.circle.d,
          height: layout.circle.d,
        }}
      />
      <div className="pin" style={{ left: `${layout.pin.x}%`, top: `${layout.pin.y}%` }} />
      {layout.me ? (
        <div className="me" style={{ left: `${layout.me.x}%`, top: `${layout.me.y}%` }} />
      ) : null}
      <div className="lbl" style={{ left: 8, top: 8 }}>
        {shift.distanceKm === null
          ? shift.venueName
          : `${formatDistance(shift.distanceKm)} from home`}
      </div>
    </div>
  );
}
