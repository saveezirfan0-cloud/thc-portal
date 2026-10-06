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

const { reverseGeocode } = await import('../actions');

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
