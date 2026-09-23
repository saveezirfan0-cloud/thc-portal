import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPostcode, lookupPostcode } from '../postcodes';

describe('extractPostcode', () => {
  it('finds the postcode at the end of an address and formats it', () => {
    expect(extractPostcode('Flat 4, 22 Roman Road, London E2 0RY')).toBe('E2 0RY');
  });

  it('reads it without a space and in any case', () => {
    expect(extractPostcode('flat 4, 22 roman road, london e20ry')).toBe('E2 0RY');
    expect(extractPostcode('Mile End, London e1  4ns')).toBe('E1 4NS');
  });

  it('handles every outward-code shape', () => {
    expect(extractPostcode('10 Downing Street, London SW1A 2AA')).toBe('SW1A 2AA');
    expect(extractPostcode('Camberwell, London SE5 8TR')).toBe('SE5 8TR');
    expect(extractPostcode('1 Piccadilly, Manchester M1 1AE')).toBe('M1 1AE');
    expect(extractPostcode('Laurie Grove, London SE14 6NW')).toBe('SE14 6NW');
    expect(extractPostcode('Donegall Square, Belfast BT1 5GS')).toBe('BT1 5GS');
  });

  it('prefers the last candidate, which is where a UK address keeps its postcode', () => {
    expect(extractPostcode('Unit B2 3RD, Dock Road, Liverpool L3 4AF')).toBe('L3 4AF');
  });

  it('returns null when nothing looks like one', () => {
    expect(extractPostcode('9 Other Road, London')).toBeNull();
    expect(extractPostcode('')).toBeNull();
    expect(extractPostcode(null)).toBeNull();
    expect(extractPostcode(undefined)).toBeNull();
  });

  it('does not read a house number or a flat letter as a postcode', () => {
    expect(extractPostcode('Flat 2B, 14 High Street, Oxford')).toBeNull();
    expect(extractPostcode('221B Baker Street, London')).toBeNull();
  });
});

describe('lookupPostcode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a shape that is not a postcode without calling out', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const result = await lookupPostcode('not a code');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the centroid, normalising the code in the request', async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(JSON.stringify({ result: { latitude: 51.529, longitude: -0.043 } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await lookupPostcode('e2 0ry');
    expect(result).toEqual({ ok: true, lat: 51.529, lng: -0.043 });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.postcodes.io/postcodes/E20RY');
  });

  it('says not found on a 404, and on a body with no point', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request) => new Response('{}', { status: 404 })),
    );
    expect(await lookupPostcode('E2 0RY')).toMatchObject({ ok: false, reason: 'not_found' });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: string | URL | Request) =>
          new Response(JSON.stringify({ result: {} }), { status: 200 }),
      ),
    );
    expect(await lookupPostcode('E2 0RY')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('says unreachable when the request throws, so the caller keeps its old point', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request): Promise<Response> => {
        throw new Error('ECONNRESET');
      }),
    );
    expect(await lookupPostcode('E2 0RY')).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
