import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The candidate screen's Verify of a University Term Dates Letter
 * (ADR-0178, with ADR-0183's tick): the periods go to verify_document() as p_term_dates, and a
 * letter verified with none needs the "this letter shows no holidays" tick
 * — the same rule as the Needs review dialog.
 */
const rpc = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// ADR-0201: the passport-expiry read is covered in passportExpiryAction.test.ts.
vi.mock('../../compliance/passportExpiry', () => ({ passportExpiryMissing: async () => false }));
vi.mock('@thc/db/server', () => ({ createClient: vi.fn(() => ({ rpc })) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { verifyDocument } = await import('../actions');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe('verifyDocument from /onboarding/:id', () => {
  it('sends the periods, half-open', async () => {
    expect(
      await verifyDocument('s1', 'd1', { periods: [{ from: '2026-08-16', to: '2027-01-17' }] }),
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('verify_document', {
      p_doc: 'd1',
      p_term_dates: ['[2026-08-16,2027-01-18)'],
    });
  });

  it('refuses no periods without the tick, before the database', async () => {
    expect(await verifyDocument('s1', 'd1', { periods: [] })).toEqual({
      ok: false,
      message: 'Tick to confirm the letter shows no holidays, or add the periods it shows.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends an empty list once ticked — zero periods is a real answer', async () => {
    await verifyDocument('s1', 'd1', { periods: [], noHolidays: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('verify_document', {
      p_doc: 'd1',
      p_term_dates: [],
    });
  });

  it('a document with no periods is verified as before', async () => {
    await verifyDocument('s1', 'd2', { periods: null, expiry: '2030-01-01' });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('verify_document', {
      p_doc: 'd2',
      p_expiry: '2030-01-01',
    });
  });
});
