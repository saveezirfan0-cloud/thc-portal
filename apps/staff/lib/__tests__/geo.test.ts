import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECK_OUT_FIX, getFix } from '../geo';

/**
 * §5.1 · one GPS reading, with a deadline. Driven by a fake `Geolocation`,
 * which is also the seam the Capacitor shell will use (ADR-0001).
 */

type Success = (pos: GeolocationPosition) => void;
type Failure = (err: GeolocationPositionError) => void;

function fakeGeo(
  behave: (ok: Success, fail: Failure, options?: PositionOptions) => void,
): Geolocation & { calls: PositionOptions[] } {
  const calls: PositionOptions[] = [];
  return {
    calls,
    getCurrentPosition: (ok: Success, fail?: Failure | null, options?: PositionOptions) => {
      calls.push(options ?? {});
      behave(ok, fail ?? (() => {}), options);
    },
    watchPosition: () => 0,
    clearWatch: () => {},
  } as unknown as Geolocation & { calls: PositionOptions[] };
}

const position = (lat: number, lng: number, accuracy = 12.4) =>
  ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;

const failure = (code: 1 | 2 | 3) =>
  ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

afterEach(() => vi.useRealTimers());

describe('getFix()', () => {
  it('check-out asks for a NEW reading: nothing cached, eight seconds at most (audit D14)', async () => {
    const geo = fakeGeo((ok) => ok(position(51.5, -0.1)));
    await getFix(geo, CHECK_OUT_FIX);
    expect(CHECK_OUT_FIX).toEqual({ timeoutMs: 8_000, maximumAgeMs: 0 });
    expect(geo.calls[0]).toMatchObject({ maximumAge: 0, timeout: 8_000, enableHighAccuracy: true });
  });

  it('answers the reading, with the accuracy rounded', async () => {
    const geo = fakeGeo((ok) => ok(position(51.5, -0.1, 12.6)));
    expect(await getFix(geo, CHECK_OUT_FIX)).toEqual({ lat: 51.5, lng: -0.1, accuracyM: 13 });
  });

  it('answers null, and says why, when the phone refuses', async () => {
    const why = vi.fn();
    const geo = fakeGeo((_ok, fail) => fail(failure(1)));
    expect(await getFix(geo, CHECK_OUT_FIX, why)).toBeNull();
    expect(why).toHaveBeenCalledWith('denied');
  });

  it('answers null when the phone never answers — the press does not hang', async () => {
    vi.useFakeTimers();
    const why = vi.fn();
    const geo = fakeGeo(() => {});
    const pending = getFix(geo, CHECK_OUT_FIX, why);
    await vi.advanceTimersByTimeAsync(8_300);
    expect(await pending).toBeNull();
    expect(why).toHaveBeenCalledWith('timeout');
  });

  it('answers null with no geolocation at all', async () => {
    const why = vi.fn();
    expect(await getFix(undefined, CHECK_OUT_FIX, why)).toBeNull();
    expect(why).toHaveBeenCalledWith('unsupported');
  });
});
