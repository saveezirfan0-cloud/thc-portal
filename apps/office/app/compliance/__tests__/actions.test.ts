import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The review actions /compliance and the /staff/:id Documents tab share
 * (§4.1). Who may review is the database's answer, not this file's: every
 * call goes through the MANAGER'S OWN SESSION — never the service key — so
 * compliance_verify_document() / compliance_reject_document() can refuse a
 * caller who is not an admin (assert_reviewer → `not_authorised`), and the
 * reviewer's identity is the audit stamp (§1.8).
 */
const rpc = vi.fn();
const createClient = vi.fn(() => ({ rpc }));
const createAdminClient = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { rejectDocument, verifyDocument } = await import('../actions');

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
});

describe('verifyDocument', () => {
  it('calls the one Verify RPC on the session client, with the confirmed date', async () => {
    rpc.mockResolvedValue({ data: { status: 'compliant' }, error: null });
    const result = await verifyDocument('d2', { expiry: '2027-06-30' });
    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledOnce();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_verify_document', {
      p_doc: 'd2',
      p_expiry: '2027-06-30',
    });
  });

  it('passes the share code’s right-to-work-until under its own name', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await verifyDocument('d4', { rightToWorkUntil: 'infinity' });
    expect(rpc).toHaveBeenCalledWith('compliance_verify_document', {
      p_doc: 'd4',
      p_right_to_work_until: 'infinity',
    });
  });

  it('a caller who is not an admin is refused by the database, in words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_authorised' } });
    expect(await verifyDocument('d1')).toEqual({
      ok: false,
      message: 'Only the office can review documents.',
    });
  });

  it('reports the §4.3 re-check’s unblock', async () => {
    rpc.mockResolvedValue({ data: { unblocked: true }, error: null });
    const result = await verifyDocument('d1');
    expect(result).toEqual({ ok: true, message: 'Verified. Everything is in order — unblocked.' });
  });
});

describe('rejectDocument', () => {
  it('refuses an empty reason before reaching the database', async () => {
    const result = await rejectDocument('d1', '   ');
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason to the one Reject RPC (N8 fires there)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await rejectDocument('d1', '  Photo page is cut off ');
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_reject_document', {
      p_doc: 'd1',
      p_reason: 'Photo page is cut off',
    });
  });

  it('a caller who is not an admin is refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_authorised' } });
    expect(await rejectDocument('d1', 'blurred')).toEqual({
      ok: false,
      message: 'Only the office can review documents.',
    });
  });
});
