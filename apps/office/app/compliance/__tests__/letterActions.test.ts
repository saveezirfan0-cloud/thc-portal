import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Correcting a decided letter (ADR-0178): both through the manager's own
 * session, so the database names who did it and refuses anyone who is not
 * an owner or a manager.
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

const { correctTermDates, withdrawCompletionApproval } = await import('../letterActions');

const PRABIN = { from: '2026-08-16', to: '2027-01-17' };

beforeEach(() => {
  rpc.mockReset();
  mayWrite = true;
});

describe('a read-only login', () => {
  it('is told so before anything is sent', async () => {
    mayWrite = false;
    expect(await correctTermDates('t1', [PRABIN], 'x')).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    expect(await withdrawCompletionApproval('c1', 'x')).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('correctTermDates', () => {
  it('sends the corrected periods, the note and the tick to the one RPC', async () => {
    rpc.mockResolvedValue({ data: { expiresOn: '2027-01-17' }, error: null });
    const result = await correctTermDates('t1', [PRABIN], '  Course restarts 18/01/2027 ');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_correct_term_dates', {
      p_doc: 't1',
      p_term_dates: ['[2026-08-16,2027-01-18)'],
      p_note: 'Course restarts 18/01/2027',
      p_no_holidays: false,
    });
    expect(result).toEqual({
      ok: true,
      message:
        'Term dates corrected. The letter now expires 17.01.2027; the weekly limit and the reminders follow the new dates.',
    });
  });

  it('refuses before the database: no note, no tick on no periods, a backwards period', async () => {
    expect(await correctTermDates('t1', [PRABIN], ' ')).toEqual({
      ok: false,
      message: 'Say why the dates are being corrected.',
    });
    expect((await correctTermDates('t1', [], 'none')).ok).toBe(false);
    expect(await correctTermDates('t1', [{ from: '2027-01-17', to: '2026-08-16' }], 'x')).toEqual({
      ok: false,
      message: 'Period 1 ends before it starts.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends an empty list once the no-holidays tick is given', async () => {
    rpc.mockResolvedValue({ data: { expiresOn: '2026-12-31' }, error: null });
    await correctTermDates('t1', [], 'The letter shows none', true);
    expect(rpc).toHaveBeenCalledWith(
      'compliance_correct_term_dates',
      expect.objectContaining({ p_term_dates: [], p_no_holidays: true }),
    );
  });

  it('puts the database’s refusals in words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_permitted' } });
    expect(await correctTermDates('t1', [PRABIN], 'x')).toEqual({
      ok: false,
      message: 'Only an owner or a manager can do this.',
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'not_current_letter' } });
    expect((await correctTermDates('t1', [PRABIN], 'x')).message).toMatch(/current term letter/);
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
