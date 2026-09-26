import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit D16, D18 · a read that failed is never an empty answer.
 *
 * Every loader used to take `{ data }` and drop `error`, so a timeout
 * rendered as "No shifts booked", "Nothing open", "No open invitations", a
 * 404 — or, for the profile, an UNLOCKED app. A worker told they have no
 * shift does not turn up and becomes a No-show; a held worker shown the
 * tabs can press Check in. Each loader now carries the error out.
 */

const rpc = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

const { findBooking, findOpenShift, loadBookings, loadOpenShifts } = await import('../data');
const { StaffLoadError, loadEarnings, loadProfile, readProfile } = await import('../profile/data');
const { loadOnboarding } = await import('../onboarding/data');

const failed = { data: null, error: { message: 'canceling statement due to timeout' } };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  rpc.mockReset();
});

describe('the working screens’ lists', () => {
  it('loadBookings() reports the failure instead of an empty list', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadBookings()).toEqual({
      rows: [],
      problem: 'canceling statement due to timeout',
    });
  });

  it('loadBookings() is a real empty list only when the read succeeded', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadBookings()).toEqual({ rows: [], problem: null });
  });

  it('loadOpenShifts() reports the failure instead of "Nothing open"', async () => {
    rpc.mockResolvedValue(failed);
    expect((await loadOpenShifts()).problem).toBe('canceling statement due to timeout');
  });

  it('findBooking() and findOpenShift() tell "could not read" from "not found"', async () => {
    rpc.mockResolvedValue(failed);
    expect(await findBooking('b1')).toEqual({ row: null, problem: expect.any(String) });
    expect(await findOpenShift('s1')).toEqual({ row: null, problem: expect.any(String) });
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await findBooking('b1')).toEqual({ row: null, problem: null });
  });

  it('with no project configured, there is nothing to fail', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await loadBookings()).toEqual({ rows: [], problem: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the profile the app lock is computed from (audit D16)', () => {
  it('readProfile() keeps "not configured", "could not load" and "ok" apart', async () => {
    rpc.mockResolvedValue(failed);
    expect(await readProfile()).toEqual({
      kind: 'problem',
      message: 'canceling statement due to timeout',
    });

    rpc.mockResolvedValue({ data: null, error: null });
    expect((await readProfile()).kind).toBe('problem');

    rpc.mockResolvedValue({ data: { staffId: 's1', status: 'compliant' }, error: null });
    const ok = await readProfile();
    expect(ok.kind).toBe('ok');

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await readProfile()).toEqual({ kind: 'unconfigured' });
  });

  it('loadProfile() throws on a failed read, where it used to answer null (= unlocked)', async () => {
    rpc.mockResolvedValue(failed);
    await expect(loadProfile()).rejects.toBeInstanceOf(StaffLoadError);
  });

  it('loadEarnings() throws on a failed read rather than showing "No earnings yet"', async () => {
    rpc.mockResolvedValue(failed);
    await expect(loadEarnings()).rejects.toBeInstanceOf(StaffLoadError);
  });

  it('loadOnboarding() throws rather than "we couldn’t find your onboarding"', async () => {
    rpc.mockResolvedValue(failed);
    await expect(loadOnboarding()).rejects.toBeInstanceOf(StaffLoadError);
  });
});
