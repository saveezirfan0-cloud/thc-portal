import {
  CHECK_IN_GRACE_MIN,
  CHECK_IN_OPENS_MIN,
  NO_CHECK_OUT_AFTER_MIN,
  addMinutes,
} from '@thc/domain';
import type { ShiftDetail } from './types';

/**
 * What the shift screen is showing right now (§5.1, §10.4).
 *
 * This mirrors the gates in `check_in_decision` / `check_out_decision`
 * rather than re-deciding them: the server is what actually allows a press,
 * and a screen that disagreed would either offer a button that fails or
 * hide one that would have worked. What it adds is the states the server
 * has no opinion about — before the window opens, and after the shift is
 * closed — and the copy for each.
 */
export type ShiftPhase =
  | 'before_window' // too early to check in
  | 'check_in' // the window is open
  | 'locked' // start+30 passed with no check-in (§5.1)
  | 'on_shift'
  | 'on_break'
  | 'check_out_locked' // end+4h: RULE-02 has taken over
  | 'closed'; // checked out

export interface PhaseInput {
  shift: Pick<ShiftDetail, 'startsAt' | 'endsAt' | 'confirmedAt' | 'checkInAt' | 'checkOutAt'>;
  openBreak: boolean;
  now: Date;
}

export function shiftPhase({ shift, openBreak, now }: PhaseInput): ShiftPhase {
  const startsAt = new Date(shift.startsAt);
  const endsAt = new Date(shift.endsAt);

  if (shift.checkOutAt) return 'closed';

  if (shift.checkInAt) {
    if (openBreak) return 'on_break';
    // RULE-02: four hours past the end the button locks and only a manager
    // can close the shift.
    return now >= addMinutes(endsAt, NO_CHECK_OUT_AFTER_MIN) ? 'check_out_locked' : 'on_shift';
  }

  if (now < addMinutes(startsAt, -CHECK_IN_OPENS_MIN)) return 'before_window';

  // The lock, and its one exception: a booking confirmed AFTER the shift
  // had already started keeps its button until the shift ends, because a
  // window measured from a start they were not booked for means nothing.
  const confirmedAfterStart = shift.confirmedAt !== null && new Date(shift.confirmedAt) > startsAt;
  const locksAt = confirmedAfterStart ? endsAt : addMinutes(startsAt, CHECK_IN_GRACE_MIN);
  return now >= locksAt ? 'locked' : 'check_in';
}

/** The check-in window the screen quotes back: "Check-in window 16:30 – 17:30". */
export function checkInWindow(startsAt: string): { opens: Date; locks: Date } {
  const start = new Date(startsAt);
  return {
    opens: addMinutes(start, -CHECK_IN_OPENS_MIN),
    locks: addMinutes(start, CHECK_IN_GRACE_MIN),
  };
}

/** Metres between two WGS-84 points — the same haversine the venue map uses. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** "You're 1.8 km from the venue" reads better than 1,800 m (§5.1 copy). */
export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`;
}
