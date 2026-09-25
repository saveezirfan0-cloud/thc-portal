/**
 * Radar's pure presentation rules — Scope §10.4, wireframes/staff/radar.html.
 *
 * Two things the wireframe draws that the RPC rows do not hand over ready
 * made: the week meter ("This week (Mon 14 – Sun 20) · 8 h of 20 h", and
 * on the detail "Week of Mon 14 with this shift · 13 h of 20 h") and the
 * ADR-0005 map block with the venue pin, its geofence and the worker's
 * home pin. Both are arithmetic on figures the database already returns,
 * so they live here, unit-tested, rather than inline in two pages.
 */

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
});

/** "Mon 14" — a `YYYY-MM-DD` calendar date as the wireframe labels it. */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return DAY_FORMAT.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** "Mon 14 – Sun 20" — the Mon–Sun week the strip describes. */
export function weekLabel(weekStart: string, weekEnd: string): string {
  return `${dayLabel(weekStart)} – ${dayLabel(weekEnd)}`;
}

export interface MeterFill {
  /** Hours the bar represents: booked, plus the shift where one is added. */
  total: number;
  /** 0–100, clamped. Zero where there is no ceiling to measure against. */
  percent: number;
  /** True once the total is past the cap (RULE-20). */
  over: boolean;
}

/**
 * How full the bar is. `shiftHours` is the detail's "with this shift":
 * the list strip passes none. A worker with no ceiling gets an empty bar
 * and `over: false` — no cap is not the same as a cap of zero.
 */
export function meterFill(
  bookedHours: number,
  capHours: number | null,
  shiftHours: number = 0,
): MeterFill {
  const total = Math.round((bookedHours + shiftHours) * 10) / 10;
  if (capHours === null || capHours <= 0) return { total, percent: 0, over: false };
  const percent = Math.min(100, Math.max(0, (total / capHours) * 100));
  return { total, percent, over: total > capHours };
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapLayout {
  /** The venue, as percentages of the surface. */
  pin: { x: number; y: number };
  /** The geofence, centred on the pin, in pixels of diameter. */
  circle: { x: number; y: number; d: number };
  /** The worker's home, or null where there is no home pin. */
  me: { x: number; y: number } | null;
}

/** Metres per degree at the equator; longitude is scaled by cos(latitude). */
const METRES_PER_DEGREE = 111_320;

/**
 * Where the pins go on a surface of `width` × `height` px (ADR-0005: no
 * GL library, an equirectangular projection is enough for a block this
 * size). With a home pin, both points are framed with a margin and the
 * scale is whatever fits the further of the two; without one, the venue
 * sits centred and the geofence is drawn at a readable size.
 *
 * The circle's diameter is the geofence at the SAME scale as the pins, so
 * "1.2 km from home" and a 150 m radius look as far apart as they are.
 * It is floored at a few pixels so a tight radius on a wide frame is
 * still visible, and capped at the frame so it never swallows the block.
 */
export function mapLayout(input: {
  venue: LatLng;
  home: LatLng | null;
  radiusM: number | null;
  width: number;
  height: number;
}): MapLayout {
  const { venue, home, width, height } = input;
  const radiusM = input.radiusM ?? 0;
  const margin = 0.18;
  const usableW = width * (1 - 2 * margin);
  const usableH = height * (1 - 2 * margin);

  if (!home) {
    // Venue alone: centre it, and let the circle take a third of the
    // shorter side so the block reads as a place, not a dot.
    const d = Math.max(24, Math.min(width, height) / 3);
    return {
      pin: { x: 50, y: 50 },
      circle: { x: 50, y: 50, d },
      me: null,
    };
  }

  // Metres east and north of the venue.
  const cos = Math.cos((venue.lat * Math.PI) / 180);
  const dx = (home.lng - venue.lng) * METRES_PER_DEGREE * cos;
  const dy = (home.lat - venue.lat) * METRES_PER_DEGREE;
  const spanM = Math.max(Math.abs(dx), 1);
  const spanNM = Math.max(Math.abs(dy), 1);
  // Pixels per metre: whichever axis is tighter decides.
  const scale = Math.min(usableW / spanM, usableH / spanNM);

  // Frame the midpoint between the two pins at the centre.
  const midX = dx / 2;
  const midY = dy / 2;
  const toX = (m: number) => 50 + ((m - midX) * scale * 100) / width;
  const toY = (m: number) => 50 - ((m - midY) * scale * 100) / height;

  const pin = { x: toX(0), y: toY(0) };
  const d = Math.min(Math.min(width, height), Math.max(6, 2 * radiusM * scale));
  return {
    pin,
    circle: { x: pin.x, y: pin.y, d },
    me: { x: toX(dx), y: toY(dy) },
  };
}
