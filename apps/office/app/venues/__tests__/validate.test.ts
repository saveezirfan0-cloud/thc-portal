import { describe, expect, it } from 'vitest';
import { validateVenue } from '../validate';
import { MAX_RADIUS_M, MIN_RADIUS_M } from '../geo';
import type { VenueDraft } from '../types';

/**
 * The form's half of the §9.11 rules. `assert_venue_input` and the `venues`
 * CHECK constraints reject exactly the same drafts in the database
 * (supabase/tests/080_venues_directory.sql), so these vectors and those
 * assertions are deliberately the same list.
 */
const CLARIDGES: VenueDraft = {
  name: "Claridge's",
  address: 'Brook Street, London W1K 4HR',
  lat: 51.5127,
  lng: -0.1477,
  venue_type: 'hotel',
  geofence_radius_m: 150,
};

const draft = (overrides: Partial<VenueDraft>): VenueDraft => ({ ...CLARIDGES, ...overrides });

describe('validateVenue', () => {
  it('accepts a venue the modal has finished filling in', () => {
    expect(validateVenue(CLARIDGES)).toBeNull();
  });

  it('needs a name that is more than whitespace', () => {
    expect(validateVenue(draft({ name: '' }))).toMatch(/name/i);
    expect(validateVenue(draft({ name: '   ' }))).toMatch(/name/i);
  });

  it('refuses to save before the pin has resolved to an address', () => {
    // §9.11: the address is reverse-geocoded, read-only, and never typed —
    // so a blank one is a lookup that has not answered, not a field a
    // manager forgot. Saving it would write a venue nobody can correct.
    expect(validateVenue(draft({ address: '' }))).toMatch(/pin/i);
  });

  it('refuses a pin that is not on the globe', () => {
    expect(validateVenue(draft({ lat: Number.NaN }))).toMatch(/pin/i);
    expect(validateVenue(draft({ lng: Number.POSITIVE_INFINITY }))).toMatch(/pin/i);
    expect(validateVenue(draft({ lat: 120 }))).toMatch(/globe/i);
    expect(validateVenue(draft({ lng: -200 }))).toMatch(/globe/i);
  });

  it('needs a venue type, because the type is what the radius defaults from', () => {
    expect(validateVenue(draft({ venue_type: '' }))).toMatch(/type/i);
  });

  it('holds the slider range the scope sets', () => {
    expect(validateVenue(draft({ geofence_radius_m: MIN_RADIUS_M }))).toBeNull();
    expect(validateVenue(draft({ geofence_radius_m: MAX_RADIUS_M }))).toBeNull();
    expect(validateVenue(draft({ geofence_radius_m: MIN_RADIUS_M - 1 }))).toMatch(/100 and 3000/);
    expect(validateVenue(draft({ geofence_radius_m: MAX_RADIUS_M + 1 }))).toMatch(/100 and 3000/);
    expect(validateVenue(draft({ geofence_radius_m: 150.5 }))).toMatch(/100 and 3000/);
  });
});
