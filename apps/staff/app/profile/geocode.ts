import { extractPostcode, geocodePostcode, type GeocodeFailure } from '../_lib/postcode';

/**
 * Where a home address edited on /profile/details puts the worker (§10.1,
 * §6 proximity).
 *
 * The profile's address is one line of free text, so the postcode is read
 * off its end (the wizard writes `line, town POSTCODE`) and looked up on
 * postcodes.io. Whatever happens the address is still saved: a failed
 * lookup hands the RPC no point, and `staff_update_contact_geocoded()`
 * then keeps the old pin and flags it stale for the office rather than
 * clearing it — a slightly wrong distance beats no distance at all.
 */
export type AddressLocation =
  | { located: true; lat: number; lng: number; postcode: string }
  | { located: false; reason: GeocodeFailure | 'no_postcode'; postcode: string | null };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function locateAddress(address: string, fetchImpl?: Fetch): Promise<AddressLocation> {
  const postcode = extractPostcode(address);
  if (!postcode) return { located: false, reason: 'no_postcode', postcode: null };
  const found = await geocodePostcode(postcode, fetchImpl);
  if (!found.ok) return { located: false, reason: found.reason, postcode };
  return { located: true, lat: found.lat, lng: found.lng, postcode: found.postcode };
}

/** The sentence after a save that changed the address, by whether it moved the pin. */
export function addressSavedNote(location: AddressLocation): string {
  if (location.located) {
    return `Saved. Venue distances now use ${location.postcode}, and we’ve let the office and payroll know your address changed.`;
  }
  const what = location.postcode
    ? `We couldn’t look up ${location.postcode} just now`
    : 'We couldn’t find a UK postcode in your address';
  return `Saved, and we’ve let the office and payroll know. ${what}, so venue distances still use your previous location until the office updates it.`;
}
