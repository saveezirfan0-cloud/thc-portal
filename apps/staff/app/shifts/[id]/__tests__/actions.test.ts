import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shift screen's buttons forward to the database and bring its refusal
 * back in the worker's words. D16: `attempt_check_in()` refuses a worker
 * who is not compliant, whatever the app's own lock believed.
 */
const rpc = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
    data: null,
    error: { message: 'staff_not_compliant' },
  })),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { checkIn, checkOut } = await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://supabase.test';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
});

describe('check-in refused for a worker who is not compliant (D16)', () => {
  it('says so in words, not the error code', async () => {
    const result = await checkIn('bk-1', 51.5, -0.1);
    expect(rpc).toHaveBeenCalledWith('attempt_check_in', {
      p_booking: 'bk-1',
      p_lat: 51.5,
      p_lng: -0.1,
    });
    expect(result).toEqual({
      error:
        'Your account is not active for shifts at the moment, so you cannot check in. Please contact the office.',
    });
  });

  it('check-out still goes to the database, which lets a shift under way close', async () => {
    rpc.mockResolvedValueOnce({ data: { decision: 'recorded_on_site' }, error: null });
    expect(await checkOut('bk-1', null, null)).toEqual({
      ok: true,
      result: { decision: 'recorded_on_site' },
    });
  });
});
