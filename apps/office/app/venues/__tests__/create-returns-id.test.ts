import { beforeEach, describe, expect, it, vi } from 'vitest';

/** As for clients: the Shift Builder selects the venue it has just created (§3.2). */
const state = vi.hoisted(() => ({
  result: { data: 'venue-new' as unknown, error: null as { message: string } | null },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: async () => state.result }) }));

const { createVenue, updateVenue } = await import('../actions');

const DRAFT = {
  name: 'Claridge’s',
  address: 'Brook St, London W1K 4HR',
  lat: 51.5127,
  lng: -0.1478,
  venue_type: 'hotel',
  geofence_radius_m: 150,
};

beforeEach(() => {
  state.result = { data: 'venue-new', error: null };
});

describe('venue writes return the new id', () => {
  it('a create carries the id the RPC returned', async () => {
    expect(await createVenue(DRAFT)).toEqual({ ok: true, id: 'venue-new' });
  });

  it('an edit has none (update_venue returns void)', async () => {
    state.result = { data: null, error: null };
    expect(await updateVenue('venue-1', DRAFT)).toEqual({ ok: true });
  });

  it('a database refusal is passed on, with no id', async () => {
    state.result = { data: null, error: { message: 'permission denied' } };
    expect(await createVenue(DRAFT)).toEqual({ ok: false, message: 'permission denied' });
  });
});
