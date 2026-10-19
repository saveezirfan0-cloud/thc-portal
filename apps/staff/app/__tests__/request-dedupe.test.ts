import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit H1/M2 · one RPC per request, however many components ask.
 *
 * `StaffShell` reads `staff_me()` for the lock and the header; the shift
 * screen, the quiz and the documents gate read it again for themselves.
 * The loaders are `React.cache`d, so in one server render they share a
 * single call. Vitest renders without React's server build, where `cache`
 * is a pass-through, so it is replaced here by the same per-render memo the
 * server build applies — what this pins is that each loader IS wrapped.
 *
 * Outside a render (a server action) React's `cache` does not memoise, so
 * an action never sees a read from before its own write.
 */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, R>();
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key)!;
      };
    },
  };
});

const rpc = vi.fn(async (fn: string) => ({
  data:
    fn === 'staff_me' ? { staff_id: 's1', first_name: 'Amara', photoPath: 's1/selfie-1.jpg' } : [],
  error: null,
}));
const createSignedUrl = vi.fn(async (path: string) => ({
  data: { signedUrl: `https://abc.supabase.co/sign/photos/${path}?token=t` },
  error: null,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc: (fn: string) => rpc(fn),
    storage: { from: () => ({ createSignedUrl: (path: string) => createSignedUrl(path) }) },
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn).length;

describe('the shell and the page share their reads', () => {
  it('staff_me() once for the shell, the page and the documents gate', async () => {
    const { readProfile, loadProfile } = await import('../profile/data');
    const { preloadShell } = await import('../_components/preloadShell');
    preloadShell();
    await Promise.all([readProfile(), readProfile(), loadProfile()]);
    expect(calls('staff_me')).toBe(1);
  });

  // Go-live audit M5: the header avatar is signed while the page's own
  // second wave runs, not after it. Documents was staff_me → (documents,
  // right-to-work) → sign; it is now staff_me → (documents, right-to-work,
  // sign).
  it('starts signing the header avatar as soon as staff_me() names it, once', async () => {
    const { readProfile } = await import('../profile/data');
    const { signOwnPhoto } = await import('../profile/photos');
    const { preloadShell } = await import('../_components/preloadShell');
    preloadShell();
    await readProfile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Signed before the shell (or the page) has asked for it.
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('s1/selfie-1.jpg');
    // The shell's own call is handed the same signature.
    expect(await signOwnPhoto('s1/selfie-1.jpg')).toContain('/sign/photos/s1/selfie-1.jpg');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  // `findOpenShift` is not in this list: since ADR-0154 /radar/[id] asks
  // `staff_open_shifts(p_shift)` for its one row rather than reading the
  // whole list, so it is a call of its own by design.
  it('each list loader is one call however often it is asked', async () => {
    const data = await import('../data');
    const offers = await import('../shifts/offers-data');
    await Promise.all([
      data.loadBookings(),
      data.findBooking('b1'),
      data.loadBookings(),
      data.loadShiftRequirements(),
      data.loadShiftRequirements(),
      data.loadOpenShifts(),
      data.loadOpenShifts(),
      data.loadWeekMeter(),
      data.loadWeekMeter(),
      offers.loadBookingOffers(),
      offers.loadBookingOffers(),
      offers.loadOpenOffers(),
      offers.loadOpenOffers(),
    ]);
    for (const fn of [
      'staff_bookings',
      'staff_shift_requirements',
      'staff_open_shifts',
      'staff_week_meter',
      'staff_booking_offers',
      'staff_open_offers',
    ]) {
      expect([fn, calls(fn)]).toEqual([fn, 1]);
    }
  });
});
