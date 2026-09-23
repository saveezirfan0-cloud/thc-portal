import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressSavedNote, locateAddress } from '../geocode';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('locateAddress — /profile/details (§10.1, §6 proximity)', () => {
  it('geocodes the postcode at the end of the edited address', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { result: { latitude: 51.5465, longitude: -0.0553 } }),
    );
    const location = await locateAddress('3 Mare Street, London E8 4RP', fetchMock);
    expect(location).toEqual({ located: true, lat: 51.5465, lng: -0.0553, postcode: 'E8 4RP' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.postcodes.io/postcodes/E84RP',
      expect.anything(),
    );
  });

  it('uses the global fetch when none is passed (the server action’s path)', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { result: { latitude: 51.5178, longitude: -0.0786 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const location = await locateAddress('12 New Street, London E1 6AN');
    expect(location.located).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back, without throwing, when postcodes.io is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const location = await locateAddress('12 New Street, London E1 6AN');
    expect(location).toEqual({ located: false, reason: 'unreachable', postcode: 'E1 6AN' });
  });

  it('falls back when the postcode is unknown', async () => {
    const location = await locateAddress('1 Nowhere Lane, ZZ9 9ZZ', async () =>
      json(404, { status: 404, error: 'Postcode not found' }),
    );
    expect(location).toEqual({ located: false, reason: 'not_found', postcode: 'ZZ9 9ZZ' });
  });

  it('does not call out at all for an address with no postcode', async () => {
    const fetchMock = vi.fn();
    const location = await locateAddress('12 New Street, London', fetchMock);
    expect(location).toEqual({ located: false, reason: 'no_postcode', postcode: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('addressSavedNote', () => {
  it('says the location moved when it did', () => {
    expect(addressSavedNote({ located: true, lat: 51.5, lng: -0.1, postcode: 'E1 6AN' })).toContain(
      'Venue distances now use E1 6AN',
    );
  });

  it('says the address saved and the old location stands when the lookup failed', () => {
    const note = addressSavedNote({ located: false, reason: 'unreachable', postcode: 'E1 6AN' });
    expect(note).toMatch(/^Saved/);
    expect(note).toContain('E1 6AN');
    expect(note).toContain('previous location');
  });

  it('asks for a postcode when there was none', () => {
    expect(addressSavedNote({ located: false, reason: 'no_postcode', postcode: null })).toContain(
      'couldn’t find a UK postcode',
    );
  });
});
