import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0201: a passport is never verified without an expiry in place, at the
 * server action both Verify buttons call, and the office can add one to a
 * passport verified without.
 */
const missing = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: vi.fn(() => ({ rpc })) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('../passportExpiry', () => ({ passportExpiryMissing: missing }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { verifyDocument, setPassportExpiry } = await import('../actions');

beforeEach(() => {
  missing.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { verified: true }, error: null });
});

describe('verifyDocument on a passport', () => {
  it('is refused, before the database, when no expiry is in place', async () => {
    missing.mockResolvedValue(true);
    const result = await verifyDocument('d1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('cannot be verified without one');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('goes ahead once an expiry is in place', async () => {
    missing.mockResolvedValue(false);
    await verifyDocument('d1', { expiry: '2031-04-09' });
    expect(rpc).toHaveBeenCalledWith('compliance_verify_document', {
      p_doc: 'd1',
      p_expiry: '2031-04-09',
    });
  });
});

describe('setPassportExpiry', () => {
  it('sends the date to set_passport_expiry', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await setPassportExpiry('d1', '2031-04-09');
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_passport_expiry', {
      p_doc: 'd1',
      p_expiry: '2031-04-09',
    });
  });

  it('refuses a date that is not a full date without calling the database', async () => {
    const result = await setPassportExpiry('d1', '09/04/2031');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says a past date in words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'already_expired: 2020-01-01' } });
    const result = await setPassportExpiry('d1', '2020-01-01');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('already expired');
  });
});
