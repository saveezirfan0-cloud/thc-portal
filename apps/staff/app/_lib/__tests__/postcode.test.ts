import { describe, expect, it, vi } from 'vitest';
import {
  compactPostcode,
  extractPostcode,
  formatPostcode,
  geocodePostcode,
  inUk,
} from '../postcode';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('extractPostcode', () => {
  it('reads the postcode off the end of the wizard’s address shape', () => {
    expect(extractPostcode('Flat 4, 22 Roman Road, London E2 0RY')).toBe('E2 0RY');
  });

  it('accepts one typed without a space, or in lower case', () => {
    expect(extractPostcode('12 New Street, London e16an')).toBe('E1 6AN');
    expect(extractPostcode('10 Downing Street, London sw1a 2aa')).toBe('SW1A 2AA');
  });

  it('takes the LAST postcode-shaped token, not a flat number that looks like one', () => {
    expect(extractPostcode('Flat B1 2AB House, 3 Mare Street, London E8 4RP')).toBe('E8 4RP');
  });

  it('is null when the address has no postcode', () => {
    expect(extractPostcode('12 New Street, London')).toBeNull();
    expect(extractPostcode('')).toBeNull();
    expect(extractPostcode(null)).toBeNull();
  });
});

describe('compactPostcode / formatPostcode', () => {
  it('normalises and formats', () => {
    expect(compactPostcode(' e2 0ry ')).toBe('E20RY');
    expect(compactPostcode('not a postcode')).toBeNull();
    expect(formatPostcode('SW1A2AA')).toBe('SW1A 2AA');
  });
});

describe('inUk', () => {
  it('is the same box the database enforces', () => {
    expect(inUk(51.53, -0.042)).toBe(true);
    expect(inUk(54.6, -5.93)).toBe(true); // Belfast
    expect(inUk(48.86, 2.35)).toBe(false); // Paris
    expect(inUk(Number.NaN, 0)).toBe(false);
  });
});

describe('geocodePostcode', () => {
  it('returns the point postcodes.io gives, for the compact code', async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { status: 200, result: { latitude: 51.5178, longitude: -0.0786 } }),
    );
    const result = await geocodePostcode('e1 6an', fetchMock);
    expect(result).toEqual({ ok: true, lat: 51.5178, lng: -0.0786, postcode: 'E1 6AN' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.postcodes.io/postcodes/E16AN',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('never calls out for something that is not a postcode', async () => {
    const fetchMock = vi.fn();
    expect(await geocodePostcode('hello', fetchMock)).toEqual({
      ok: false,
      reason: 'bad_postcode',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a 404 is not_found; any other failure status is unreachable', async () => {
    expect(await geocodePostcode('E1 6AN', async () => json(404, { status: 404 }))).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await geocodePostcode('E1 6AN', async () => json(502, {}))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('a network error or timeout does not throw', async () => {
    const result = await geocodePostcode('E1 6AN', async () => {
      throw new TypeError('fetch failed');
    });
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('a result with no coordinates is not_found (terminated postcodes)', async () => {
    const result = await geocodePostcode('E1 6AN', async () =>
      json(200, { result: { latitude: null, longitude: null } }),
    );
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a point outside the UK is refused rather than saved', async () => {
    const result = await geocodePostcode('E1 6AN', async () =>
      json(200, { result: { latitude: 48.86, longitude: 2.35 } }),
    );
    expect(result).toEqual({ ok: false, reason: 'outside_uk' });
  });
});
