import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * reverseGeocode (§9.11) is a server action — a public POST endpoint — that
 * spends the Mapbox token and passes through no RLS. It checks the caller
 * is a signed-in admin itself (audit D52), before any request leaves.
 */
const state = vi.hoisted(() => ({
  user: { id: 'manager-1' } as { id: string } | null,
  role: 'admin' as string | null,
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }),
        }),
      }),
    }),
  }),
}));

const fetchMock = vi.fn(
  async () =>
    new Response(
      JSON.stringify({ features: [{ properties: { full_address: '1 Test Street, London' } }] }),
      { status: 200 },
    ),
);

const { reverseGeocode, searchPlaces } = await import('../actions');

const saved = { ...process.env };
beforeAll(() => {
  process.env['MAPBOX_TOKEN'] = 'pk.test';
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(() => {
  process.env = saved;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  fetchMock.mockClear();
  state.user = { id: 'manager-1' };
  state.role = 'admin';
});

describe('reverseGeocode (§9.11, D52)', () => {
  it('answers a signed-in admin', async () => {
    expect(await reverseGeocode(51.5, -0.1)).toEqual({
      ok: true,
      address: '1 Test Street, London',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a worker', { id: 'w1' }, 'staff'],
    ['a client', { id: 'c1' }, 'client'],
    ['nobody', null, null],
  ])('refuses %s without spending the token', async (_who, user, role) => {
    state.user = user;
    state.role = role;
    expect(await reverseGeocode(51.5, -0.1)).toEqual({
      ok: false,
      message: 'Only the office can look up addresses.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to OpenStreetMap when no Mapbox token is set (ADR-0093)', async () => {
    const before = { ...process.env };
    delete process.env['MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ display_name: '2 Test Road, London' }), { status: 200 }),
    );
    try {
      expect(await reverseGeocode(51.5, -0.1)).toEqual({
        ok: true,
        address: '2 Test Road, London',
      });
      const called = String((fetchMock.mock.calls[0] as unknown[])[0]);
      expect(called).toContain('nominatim.openstreetmap.org/reverse');
    } finally {
      process.env = before;
    }
  });

  it('reports no address when OpenStreetMap has none for the point', async () => {
    const before = { ...process.env };
    delete process.env['MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unable to geocode' }), { status: 200 }),
    );
    try {
      expect(await reverseGeocode(0, 0)).toEqual({
        ok: false,
        message: 'No address at this point — move the pin.',
      });
    } finally {
      process.env = before;
    }
  });
});

describe('searchPlaces (§9.11, ADR-0101)', () => {
  const withoutMapboxToken = async (run: () => Promise<void>) => {
    const before = { ...process.env };
    delete process.env['MAPBOX_TOKEN'];
    delete process.env['NEXT_PUBLIC_MAPBOX_TOKEN'];
    try {
      await run();
    } finally {
      process.env = before;
    }
  };

  it('finds a postcode with Mapbox, limited to Great Britain', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: { coordinates: [-0.1477, 51.5127] },
              properties: { full_address: 'Brook Street, London W1K 4HR, United Kingdom' },
            },
            {
              // A postcode feature has no full_address: name + place_formatted.
              geometry: { coordinates: [-0.15, 51.51] },
              properties: { name: 'W1K 4HR', place_formatted: 'London, England' },
            },
            { geometry: {}, properties: { full_address: 'no coordinates' } },
          ],
        }),
        { status: 200 },
      ),
    );

    expect(await searchPlaces('  w1k   4hr ')).toEqual({
      ok: true,
      matches: [
        { address: 'Brook Street, London W1K 4HR, United Kingdom', lat: 51.5127, lng: -0.1477 },
        { address: 'W1K 4HR, London, England', lat: 51.51, lng: -0.15 },
      ],
    });
    const called = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(called.pathname).toBe('/search/geocode/v6/forward');
    expect(called.searchParams.get('q')).toBe('w1k 4hr');
    expect(called.searchParams.get('country')).toBe('gb');
  });

  it('falls back to OpenStreetMap search when no Mapbox token is set (ADR-0093)', async () => {
    await withoutMapboxToken(async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { display_name: '49, Brook Street, Mayfair, London', lat: '51.5127', lon: '-0.1477' },
            { display_name: 'bad row', lat: 'x', lon: '1' },
          ]),
          { status: 200 },
        ),
      );
      expect(await searchPlaces('49 Brook Street')).toEqual({
        ok: true,
        matches: [{ address: '49, Brook Street, Mayfair, London', lat: 51.5127, lng: -0.1477 }],
      });
      const called = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
      expect(called.host).toBe('nominatim.openstreetmap.org');
      expect(called.pathname).toBe('/search');
      expect(called.searchParams.get('countrycodes')).toBe('gb');
    });
  });

  it('says so when nothing matches', async () => {
    await withoutMapboxToken(async () => {
      fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
      expect(await searchPlaces('zzzzzz')).toMatchObject({ ok: false });
    });
  });

  it('reports a provider failure instead of an empty list', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    expect(await searchPlaces('W1K 4HR')).toEqual({
      ok: false,
      message: 'Address search failed (429). Try again.',
    });
  });

  it.each([
    ['a worker', { id: 'w1' }, 'staff'],
    ['nobody', null, null],
  ])('refuses %s without spending the token', async (_who, user, role) => {
    state.user = user;
    state.role = role;
    expect(await searchPlaces('W1K 4HR')).toEqual({
      ok: false,
      message: 'Only the office can look up addresses.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[''], ['  '], ['ab'], ['x'.repeat(201)]])(
    'rejects an unusable query (%j) before any request leaves',
    async (query) => {
      expect(await searchPlaces(query)).toMatchObject({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
