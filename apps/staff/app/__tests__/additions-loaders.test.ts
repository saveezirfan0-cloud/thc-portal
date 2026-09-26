import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit D18 on the docs/19 additions' loaders: a read that failed is never
 * an empty answer. Each one carries the RPC's error out as `problem`, the
 * `Loaded` / `Found` shape of `apps/staff/app/data.ts`, so the screen can
 * show `<LoadProblem>` instead of "nothing here":
 *
 *   loadBookingOffers   a missing Offered chip; "Offer this shift" on a
 *                       shift already offered
 *   loadOpenOffers      "Nothing open nearby" on Radar
 *   findOpenOffer       a 404 for an offer the worker can take
 *   loadUnavailability  an empty calendar
 *   loadEmergencyContact an empty form over a contact we could not see
 *   loadChangeRequests  no pending line, and a second request form
 *   loadReferral        "No one yet" to a worker whose friends applied
 */

const rpc = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

const { findOpenOffer, loadBookingOffers, loadOpenOffers, offersByBooking } =
  await import('../shifts/offers-data');
const { loadUnavailability } = await import('../profile/availability/data');
const { loadChangeRequests, loadEmergencyContact } = await import('../profile/data');
const { loadReferral } = await import('../profile/refer/data');

const TIMEOUT = 'canceling statement due to timeout';
const failed = { data: null, error: { message: TIMEOUT } };
const empty = { data: [], error: null };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  rpc.mockReset();
});

describe('offers (ADR-0045)', () => {
  it('loadBookingOffers() reports the failure instead of "no offers"', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadBookingOffers()).toEqual({ rows: [], problem: TIMEOUT });
  });

  it('loadBookingOffers() is a real empty list only when the read succeeded', async () => {
    rpc.mockResolvedValue(empty);
    expect(await loadBookingOffers()).toEqual({ rows: [], problem: null });
  });

  it('offersByBooking() keys the rows by booking', async () => {
    rpc.mockResolvedValue({
      data: [{ booking_id: 'b1', auto_assign: true, offer_id: 'o1', offer_mode: 'pool' }],
      error: null,
    });
    const { rows } = await loadBookingOffers();
    expect(offersByBooking(rows).get('b1')?.offerId).toBe('o1');
  });

  it('loadOpenOffers() reports the failure instead of "Nothing open nearby"', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadOpenOffers()).toEqual({ rows: [], problem: TIMEOUT });
    rpc.mockResolvedValue(empty);
    expect(await loadOpenOffers()).toEqual({ rows: [], problem: null });
  });

  it('findOpenOffer() tells "could not read" from "not yours to see"', async () => {
    rpc.mockResolvedValue(failed);
    expect(await findOpenOffer('o1')).toEqual({ row: null, problem: TIMEOUT });
    rpc.mockResolvedValue(empty);
    expect(await findOpenOffer('o1')).toEqual({ row: null, problem: null });
    expect(rpc).toHaveBeenLastCalledWith('staff_open_offers', { p_offer: 'o1' });
  });

  it('with no project configured, there is nothing to fail', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await loadBookingOffers()).toEqual({ rows: [], problem: null });
    expect(await loadOpenOffers()).toEqual({ rows: [], problem: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('availability (ADR-0042)', () => {
  it('loadUnavailability() reports the failure instead of an empty calendar', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadUnavailability()).toEqual({ rows: [], problem: TIMEOUT });
    rpc.mockResolvedValue(empty);
    expect(await loadUnavailability()).toEqual({ rows: [], problem: null });
  });
});

describe('emergency contact (ADR-0043)', () => {
  it('keeps "none saved" and "could not read" apart', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadEmergencyContact()).toEqual({ row: null, problem: TIMEOUT });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadEmergencyContact()).toEqual({ row: null, problem: null });
    rpc.mockResolvedValue({
      data: { name: 'Ada', relationship: 'Sister', phone: '+447700900001' },
      error: null,
    });
    expect((await loadEmergencyContact()).row?.name).toBe('Ada');
  });
});

describe('change requests (ADR-0044)', () => {
  it('loadChangeRequests() reports the failure instead of "no requests"', async () => {
    rpc.mockResolvedValue(failed);
    expect(await loadChangeRequests()).toEqual({ rows: [], problem: TIMEOUT });
    rpc.mockResolvedValue(empty);
    expect(await loadChangeRequests()).toEqual({ rows: [], problem: null });
  });
});

describe('refer a friend (ADR-0046)', () => {
  const answer = (fn: string) =>
    fn === 'my_referral_code'
      ? { data: 'K7Q2M9XH', error: null }
      : { data: { applied: 3 }, error: null };

  it('a failed count is a problem, never "No one yet"', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'my_referral_summary' ? failed : answer(fn),
    );
    const read = await loadReferral();
    expect(read.code).toEqual({ row: 'K7Q2M9XH', problem: null });
    expect(read.applied).toEqual({ row: null, problem: TIMEOUT });
  });

  it('a failed code is a problem, not a missing link', async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'my_referral_code' ? failed : answer(fn)));
    const read = await loadReferral();
    expect(read.code).toEqual({ row: null, problem: TIMEOUT });
    expect(read.applied).toEqual({ row: 3, problem: null });
  });

  it('both read: the code and the count', async () => {
    rpc.mockImplementation(async (fn: string) => answer(fn));
    expect(await loadReferral()).toEqual({
      code: { row: 'K7Q2M9XH', problem: null },
      applied: { row: 3, problem: null },
    });
  });
});
