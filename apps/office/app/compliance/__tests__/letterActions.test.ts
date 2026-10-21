import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Withdrawing a completion letter's approval (ADR-0183): through the
 * manager's own session, so the database names who did it and refuses
 * anyone who is not the office.
 */
/** The letter RPCs; office_can('write') answers `mayWrite` first. */
const rpc = vi.fn();
let mayWrite = true;
const session = {
  rpc: (fn: string, args?: unknown) =>
    fn === 'office_can'
      ? Promise.resolve({ data: mayWrite, error: null })
      : fn === 'current_app_role'
        ? Promise.resolve({ data: 'admin', error: null })
        : rpc(fn, args),
};
const createClient = vi.fn(() => session);

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { withdrawCompletionApproval } = await import('../letterActions');

beforeEach(() => {
  rpc.mockReset();
  mayWrite = true;
});

describe('a read-only login', () => {
  it('is told so before anything is sent', async () => {
    mayWrite = false;
    expect(await withdrawCompletionApproval('c1', 'x')).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('withdrawCompletionApproval', () => {
  it('needs a reason, and sends it trimmed', async () => {
    expect((await withdrawCompletionApproval('c1', '  ')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { termLetterId: 't1' }, error: null });
    const result = await withdrawCompletionApproval(
      'c1',
      ' Course resumes 18/01/2027 — not completed ',
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_withdraw_completion_approval', {
      p_doc: 'c1',
      p_reason: 'Course resumes 18/01/2027 — not completed',
    });
    expect(result.ok && result.message).toMatch(/term letter decides the weekly limit again/);
  });

  it('says how many approvals went, when a worker had two', async () => {
    rpc.mockResolvedValue({ data: { termLetterId: 't1', withdrawnCount: 2 }, error: null });
    expect((await withdrawCompletionApproval('c1', 'x')).message).toMatch(
      /^Approval withdrawn \(2 approved letters\)\./,
    );
  });

  it('says so when there is no current term letter to fall back on', async () => {
    rpc.mockResolvedValue({ data: { termLetterId: null }, error: null });
    expect((await withdrawCompletionApproval('c1', 'x')).message).toMatch(
      /ask the worker to upload/,
    );
  });
});
