import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shift screen's buttons forward to the database and bring its refusal
 * back in the worker's words. D16: `attempt_check_in()` refuses a worker
 * who is not compliant, whatever the app's own lock believed.
 */
const rpc = vi.hoisted(() =>
  vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => ({
      data: null,
      error: { message: 'staff_not_compliant' },
    }),
  ),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

const { checkIn, checkOut, finishBreak, recordPing, startBreak } = await import('../actions');

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
      p_accuracy: null,
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

/**
 * Security round 12.10, item 6: the database weighs the fix's accuracy
 * radius (`coords.accuracy`, metres), so every action that carries a fix
 * carries it too as `p_accuracy` — and never invents one.
 */
describe('the GPS accuracy goes with every fix', () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: {}, error: null });
  });

  it('check-in, check-out and the ping each send p_accuracy in metres', async () => {
    await checkIn('bk-1', 51.5, -0.1, 12);
    expect(rpc).toHaveBeenLastCalledWith('attempt_check_in', {
      p_booking: 'bk-1',
      p_lat: 51.5,
      p_lng: -0.1,
      p_accuracy: 12,
    });
    await checkOut('bk-1', 51.5, -0.1, 30);
    expect(rpc).toHaveBeenLastCalledWith('check_out', {
      p_booking: 'bk-1',
      p_lat: 51.5,
      p_lng: -0.1,
      p_accuracy: 30,
    });
    await recordPing('bk-1', 51.5, -0.1, 1800);
    expect(rpc).toHaveBeenLastCalledWith('record_ping', {
      p_booking: 'bk-1',
      p_lat: 51.5,
      p_lng: -0.1,
      p_accuracy: 1800,
    });
  });

  it('an accuracy that is not a real radius is sent as unknown, never as zero', async () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      await checkIn('bk-1', 51.5, -0.1, bad);
      expect(rpc).toHaveBeenLastCalledWith(
        'attempt_check_in',
        expect.objectContaining({ p_accuracy: null }),
      );
    }
  });

  it('a check-out with no fix sends no accuracy either', async () => {
    await checkOut('bk-1', null, null, 25);
    expect(rpc).toHaveBeenLastCalledWith('check_out', {
      p_booking: 'bk-1',
      p_lat: null,
      p_lng: null,
      p_accuracy: null,
    });
  });
});

describe('the database is still on the three-argument functions (deploy order)', () => {
  it('a check-in is made again without the accuracy, and goes through', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.attempt_check_in' },
    });
    rpc.mockResolvedValueOnce({ data: { decision: 'recorded_on_site' }, error: null });
    const result = await checkIn('bk-1', 51.5, -0.1, 12);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('attempt_check_in', {
      p_booking: 'bk-1',
      p_lat: 51.5,
      p_lng: -0.1,
    });
    expect(result).toEqual({ ok: true, result: { decision: 'recorded_on_site' } });
  });

  it('any other refusal is not retried', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'staff_not_compliant' } });
    await checkOut('bk-1', 51.5, -0.1, 12);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

/**
 * Go-live audit B3. A press that changes the booking revalidates, so the
 * fresh page comes back inside the action's own response (and the screen
 * calls no `router.refresh()` on top). A ping changes nothing on screen and
 * must not re-render the page every two minutes for every worker on shift.
 */
describe('which presses re-render the shift page', () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: {}, error: null });
  });

  it('check-in, check-out and both break presses revalidate the shift', async () => {
    await checkIn('bk-1', 51.5, -0.1, 12);
    await checkOut('bk-1', null, null);
    await startBreak('bk-1');
    await finishBreak('bk-1');
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    for (const call of revalidatePath.mock.calls) expect(call).toEqual(['/shifts/bk-1']);
  });

  it('a location ping goes to the database and revalidates nothing', async () => {
    expect(await recordPing('bk-1', 51.5, -0.1, 12)).toEqual({ ok: true, result: {} });
    expect(rpc).toHaveBeenCalledWith('record_ping', expect.anything());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a refused press revalidates nothing either', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_checked_in' } });
    await startBreak('bk-1');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
