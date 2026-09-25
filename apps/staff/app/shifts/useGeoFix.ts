'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One position the device reported (§5.1). */
export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

export const GPS_UNAVAILABLE =
  'This device cannot share its location, so check-in cannot verify you are on site.';
export const GPS_DENIED =
  'Location is off. Turn it on for this app — check-in has to verify you are at the venue.';

/**
 * The device's position, as the shift screens need it (§5.1).
 *
 * `locate()` takes ONE fresh fix and resolves with it, which is what a
 * check-in or check-out press wants: the fix sent to the server is the one
 * taken at the moment of the tap, never a stale one from when the screen
 * opened. `watch` keeps the fix moving while the screen is open — the
 * out-of-radius chip goes green as the worker walks in, without a reload
 * (wireframe (b)→(c)) — through `watchPosition`, which is the best a PWA
 * can do (ADR-0001, docs/06 Option A).
 */
export function useGeoFix(watch: boolean): {
  fix: GpsFix | null;
  gpsError: string | null;
  locate: () => Promise<GpsFix | null>;
} {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const latest = useRef<GpsFix | null>(null);

  const accept = useCallback((pos: GeolocationPosition): GpsFix => {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy),
    };
    latest.current = next;
    setFix(next);
    setGpsError(null);
    return next;
  }, []);

  const locate = useCallback(async (): Promise<GpsFix | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError(GPS_UNAVAILABLE);
      return null;
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(accept(pos)),
        () => {
          setGpsError(GPS_DENIED);
          resolve(latest.current);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
  }, [accept]);

  useEffect(() => {
    void locate();
  }, [locate]);

  useEffect(() => {
    if (!watch || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => accept(pos),
      () => setGpsError(GPS_DENIED),
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watch, accept]);

  return { fix, gpsError, locate };
}
