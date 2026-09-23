import { POSTCODE_SQL_PATTERN, formatPostcode, normalisePostcode } from '@thc/domain';

/**
 * UK postcodes, for the two places the Staff App turns one into a point:
 * onboarding step 2/11, where it centres the map before the worker drops
 * a pin, and a home-address edit on the profile (ADR-0025), where the
 * postcode's centroid becomes the pin.
 *
 * postcodes.io is open data, no key, UK-only — which is exactly the
 * population. Its centroid is within ~100 m of the postcode's addresses.
 * §6 scores proximity at 100 − km × 9, so a tenth of a kilometre is under
 * one point, and nothing else reads `home_location` (the check-in
 * geofence is drawn around the venue, never the worker).
 */

export type PostcodeLookup =
  | { ok: true; lat: number; lng: number }
  | {
      ok: false;
      /** Why: the shape, the postcode itself, or the service. */
      reason: 'invalid' | 'not_found' | 'unreachable';
      message: string;
    };

/**
 * The strict shape, once whitespace is gone: outward code + inward code.
 * The same string `onboarding_save_address()` and
 * `staff_set_home_location_from_postcode()` check.
 */
const STRICT = new RegExp(POSTCODE_SQL_PATTERN);

/**
 * A postcode inside free text. Spaces are optional ("E20RY" is "E2 0RY")
 * and case is ignored. `\b` keeps a house number or a flat letter from
 * starting one, and the strict check afterwards drops anything the loose
 * form let through.
 */
const IN_TEXT = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/gi;

/**
 * The postcode in a free-text address, formatted ("E2 0RY"), or null.
 *
 * The LAST match wins: a UK address ends with its postcode, so an earlier
 * token that happens to look like one ("Unit B2 3RD") loses to it. A
 * shape that passes here can still be a postcode that does not exist;
 * `lookupPostcode` answers that.
 */
export function extractPostcode(address: string | null | undefined): string | null {
  if (!address) return null;
  let last: string | null = null;
  for (const match of address.matchAll(IN_TEXT)) {
    last = `${match[1]}${match[2]}`;
  }
  if (last === null) return null;
  const pc = normalisePostcode(last);
  return STRICT.test(pc) ? formatPostcode(pc) : null;
}

/** postcodes.io answers in well under a second; a hung save is worse than "unreachable". */
const TIMEOUT_MS = 5_000;

/**
 * Postcode → its centroid, from postcodes.io.
 *
 * Three refusals, three sentences, and a `reason` so a caller can tell
 * them apart without reading the sentence: a shape that is not a postcode
 * is the worker's to fix, an unknown one is theirs to check, and an
 * unreachable service is nobody's — the caller decides what to do with
 * the point it already has.
 */
export async function lookupPostcode(postcode: string): Promise<PostcodeLookup> {
  const code = normalisePostcode(postcode);
  if (!STRICT.test(code)) {
    return { ok: false, reason: 'invalid', message: 'Enter a UK postcode, e.g. E2 0RY.' };
  }
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${code}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: 'not_found', message: 'We couldn’t find that postcode.' };
    }
    const body = (await response.json()) as { result?: { latitude?: number; longitude?: number } };
    const lat = body.result?.latitude;
    const lng = body.result?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { ok: false, reason: 'not_found', message: 'We couldn’t find that postcode.' };
    }
    return { ok: true, lat, lng };
  } catch {
    return {
      ok: false,
      reason: 'unreachable',
      message: 'Postcode search is unreachable — use your location or move the map.',
    };
  }
}
