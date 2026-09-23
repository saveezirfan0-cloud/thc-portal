/**
 * UK postcodes → a point, via postcodes.io (open data, no key, UK-only —
 * which is exactly THC's population).
 *
 * One geocoder for the whole Staff App. The onboarding wizard's address
 * step (§10.3 2/11) uses it to centre the map before the worker drops a
 * pin; /profile/details (§10.1) uses it to move `staff.home_location` when
 * a worker edits their address, so the §6 proximity score does not go
 * stale. Deliberately not a server action itself: the two callers wrap it
 * in their own, and the pure parts are unit-tested without a network.
 */

/** Outward + inward code, spaces removed, upper case: `E20RY`. */
export const POSTCODE_COMPACT = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/**
 * The UK box `onboarding_save_address()` and
 * `staff_update_contact_geocoded()` both enforce. Great Britain and
 * Northern Ireland, generously: a point in the Atlantic is a bad lookup and
 * would rank every venue as far away.
 */
export const UK_BOUNDS = { minLat: 49.0, maxLat: 61.0, minLng: -9.0, maxLng: 2.5 } as const;

export function inUk(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UK_BOUNDS.minLat &&
    lat <= UK_BOUNDS.maxLat &&
    lng >= UK_BOUNDS.minLng &&
    lng <= UK_BOUNDS.maxLng
  );
}

/** `e2 0ry` / `E20RY` → `E20RY`, or null when it is not a postcode's shape. */
export function compactPostcode(input: string): string | null {
  const code = input.replace(/\s+/g, '').toUpperCase();
  return POSTCODE_COMPACT.test(code) ? code : null;
}

/** `E20RY` → `E2 0RY` — the inward code is always the last three. */
export function formatPostcode(compact: string): string {
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/**
 * The postcode in a free-text home address, formatted, or null.
 *
 * The profile's address is one line of text — the wizard writes it as
 * `line, town POSTCODE` — so the postcode is the LAST postcode-shaped
 * token, not the first: "Flat 1A, 22 Roman Road, London E2 0RY" must not
 * match "1A 22R…". Mirrors `new_starter_postcode()` in SQL, which reads
 * the same column for the HMRC New Starter report.
 */
export function extractPostcode(address: string | null | undefined): string | null {
  if (!address) return null;
  const pattern = /\b([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})\b/gi;
  let last: string | null = null;
  for (const match of address.matchAll(pattern)) {
    last = `${match[1]}${match[2]}`.toUpperCase();
  }
  return last && POSTCODE_COMPACT.test(last) ? formatPostcode(last) : null;
}

export type GeocodeFailure = 'bad_postcode' | 'not_found' | 'outside_uk' | 'unreachable';

export type GeocodeResult =
  { ok: true; lat: number; lng: number; postcode: string } | { ok: false; reason: GeocodeFailure };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Look a postcode up. Never throws: a network failure, a 404, a body
 * without coordinates and a point outside the UK box each come back as a
 * reason, so a caller can save what it has and say what it could not do.
 */
export async function geocodePostcode(
  postcode: string,
  fetchImpl: Fetch = fetch,
): Promise<GeocodeResult> {
  const code = compactPostcode(postcode);
  if (!code) return { ok: false, reason: 'bad_postcode' };
  try {
    const response = await fetchImpl(`https://api.postcodes.io/postcodes/${code}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 404 ? 'not_found' : 'unreachable' };
    }
    const body = (await response.json()) as {
      result?: { latitude?: unknown; longitude?: unknown } | null;
    };
    const lat = body.result?.latitude;
    const lng = body.result?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { ok: false, reason: 'not_found' };
    }
    if (!inUk(lat, lng)) return { ok: false, reason: 'outside_uk' };
    return { ok: true, lat, lng, postcode: formatPostcode(code) };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
