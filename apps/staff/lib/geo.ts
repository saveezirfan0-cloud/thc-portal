/**
 * One GPS fix, the way the shift screen asks for it (§5.1).
 *
 * Browser-only, but written against the `Geolocation` interface rather than
 * `navigator` so it can be driven by a fake in tests — and so the Capacitor
 * shell (ADR-0001, docs/06) can hand in its own implementation behind the
 * same call.
 */

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
}

export type FixFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export interface FixOptions {
  /** Give up after this long and answer null. */
  timeoutMs: number;
  /** How old a cached position may be. 0 = a new reading, nothing cached. */
  maximumAgeMs: number;
}

/**
 * Check-out (audit D14): a NEW reading taken at the press, never the fix the
 * screen happened to be holding. A worker who opened the screen on site and
 * pressed Check out an hour later from the bus stop must not send the
 * on-site reading — `check_out()` would take it as an on-site press and pay
 * them to now. Eight seconds is as long as a worker will wait on a button;
 * with no reading by then the press goes with no coordinates at all, and
 * the server records the last on-site fix from the ping trail, or raises
 * RULE-02's No check-out.
 */
export const CHECK_OUT_FIX: FixOptions = { timeoutMs: 8_000, maximumAgeMs: 0 };

/** Check-in: a reading at the press, allowing one taken in the last few seconds. */
export const CHECK_IN_FIX: FixOptions = { timeoutMs: 10_000, maximumAgeMs: 5_000 };

/** The screen's own location line and the background pings. */
export const TRACKING_FIX: FixOptions = { timeoutMs: 10_000, maximumAgeMs: 5_000 };

export async function getFix(
  geo: Geolocation | undefined | null,
  options: FixOptions,
  onFailure?: (why: FixFailure) => void,
): Promise<Fix | null> {
  if (!geo) {
    onFailure?.('unsupported');
    return null;
  }
  return new Promise<Fix | null>((resolve) => {
    let settled = false;
    // Some browsers do not start the `timeout` clock until a pending
    // permission prompt is answered; the press must not wait on that.
    const guard = setTimeout(() => settle(null, 'timeout'), options.timeoutMs + 250);
    const settle = (value: Fix | null, why?: FixFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (why) onFailure?.(why);
      resolve(value);
    };
    geo.getCurrentPosition(
      (pos) =>
        settle({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
        }),
      (err) =>
        settle(
          null,
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable',
        ),
      { enableHighAccuracy: true, timeout: options.timeoutMs, maximumAge: options.maximumAgeMs },
    );
  });
}
