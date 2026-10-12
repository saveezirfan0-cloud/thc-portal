import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refusal from create_venue / update_venue / delete_venue reaches the
 * venue modal in the office's words, never as the database's raw text
 * (security review, NOTE item 5): the raw text names ids and constraints.
 */
const rpc = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ error: null as null | { message: string } })),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { deleteVenue, updateVenue } = await import('../actions');

const DRAFT = {
  name: 'The Grand',
  address: '1 Test Street, London',
  lat: 51.5,
  lng: -0.1,
  venue_type: 'indoor',
  geofence_radius_m: 150,
} as Parameters<typeof updateVenue>[1];

const refuse = (message: string) => rpc.mockResolvedValueOnce({ error: { message } });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

describe('venue refusals (NOTE 5)', () => {
  it('says a venue that has gone is gone, without its id', async () => {
    refuse('No live venue 6b0c1f9e-0000-4000-8000-000000000001');
    const result = await deleteVenue('6b0c1f9e-0000-4000-8000-000000000001');
    expect(result).toEqual({
      ok: false,
      message: 'This venue no longer exists — refresh the page.',
    });
  });

  it('keeps the database’s own sentences in the office’s words', async () => {
    refuse('Latitude 95 is out of range');
    expect(await updateVenue('v1', DRAFT)).toEqual({
      ok: false,
      message: 'The pin is outside the map’s range — move it.',
    });
    refuse('read_only');
    expect(await updateVenue('v1', DRAFT)).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    refuse('new row violates row-level security policy for table "venues"');
    expect(await updateVenue('v1', DRAFT)).toEqual({
      ok: false,
      message: 'Only the office can change venues.',
    });
  });

  it('turns anything else into one generic line, logged on the server', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refuse('new row for relation "venues" violates check constraint "venues_radius_check"');
    const result = await updateVenue('v1', DRAFT);
    expect(result).toEqual({
      ok: false,
      message: 'The venue could not be saved. Refresh the page and try again.',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
